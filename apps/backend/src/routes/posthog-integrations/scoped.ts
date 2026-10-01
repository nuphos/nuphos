import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { accessView, bindingAccessUpdateSchema, normalizeAccessInput } from '@/lib/byos/access'
import { invalidatePosthogAccessToken } from '@/lib/byos/posthog-tokens'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requirePosthogIntegration, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import {
  discoverWithBinding,
  pickProjects,
  posthogPublicView,
  projectIdsSchema,
} from '@/routes/posthog-integrations/shared'

import type { PosthogIntegrationVariables } from '@/middleware/auth'

export const posthogIntegrationScoped = new Hono<{ Variables: PosthogIntegrationVariables }>()

posthogIntegrationScoped.use('*', requirePosthogIntegration())

function notBound(): AppError {
  return new AppError(404, 'posthog_integration_not_bound', 'PostHog integration not found')
}

posthogIntegrationScoped.get('/', (c) => c.json(posthogPublicView(c.get('posthogBinding'))))

posthogIntegrationScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const bindingId = new ObjectId(c.get('posthogIntegrationId'))
  const result = await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { posthogIntegrations: { id: bindingId } },
      $set: { updatedAt: new Date() },
    },
  )

  if (result.modifiedCount === 0) throw notBound()
  invalidatePosthogAccessToken(teamId, bindingId)

  return c.body(null, 204)
})

posthogIntegrationScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) =>
  c.json(accessView(c.get('posthogAccess'))),
)

posthogIntegrationScoped.put(
  '/access',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindingAccessUpdateSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))
    const res = await teamByosBindings().updateOne(
      { _id: teamId, 'posthogIntegrations.id': new ObjectId(c.get('posthogIntegrationId')) },
      { $set: { 'posthogIntegrations.$.access': access, updatedAt: new Date() } },
    )

    if (res.matchedCount === 0) throw notBound()

    return c.json(accessView(access))
  },
)

posthogIntegrationScoped.get('/available-projects', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const discovery = await discoverWithBinding(teamId, c.get('posthogBinding'))

  return c.json({ projects: discovery.projects })
})

posthogIntegrationScoped.put(
  '/projects',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', z.object({ projectIds: projectIdsSchema }).strict()),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = c.get('posthogBinding')
    const discovery = await discoverWithBinding(teamId, binding)
    const projects = pickProjects(discovery.projects, c.req.valid('json').projectIds)
    const res = await teamByosBindings().updateOne(
      { _id: teamId, 'posthogIntegrations.id': binding.id },
      { $set: { 'posthogIntegrations.$.projects': projects, updatedAt: new Date() } },
    )

    if (res.matchedCount === 0) throw notBound()

    return c.json(posthogPublicView({ ...binding, projects }))
  },
)
