import { Hono } from 'hono'

import { accessView, bindingAccessUpdateSchema, normalizeAccessInput } from '@/lib/byos/access'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireGcpMemberAccess, requireGcpProject, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import { registerGcpCloudRunRoutes } from './cloud-run'
import { registerGcpComputeRoutes } from './compute'
import { registerGcpCredentialRoutes, registerGkeKubeconfigRoute } from './credentials'
import { registerGcpMonitoringRoutes } from './monitoring'

import type { GcpProjectVariables } from '@/middleware/auth'

export const gcpProjectScoped = new Hono<{ Variables: GcpProjectVariables }>()

gcpProjectScoped.use('*', requireGcpProject())

gcpProjectScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) => {
  return c.json(accessView(c.get('gcpBinding').access))
})

gcpProjectScoped.put(
  '/access',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindingAccessUpdateSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const serviceAccountId = c.get('gcpBinding').id
    const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))

    await teamByosBindings().updateOne(
      { _id: teamId, 'gcpServiceAccounts.id': serviceAccountId },
      {
        $set: {
          'gcpServiceAccounts.$.access': access,
          updatedAt: access.updatedAt,
        },
      },
    )

    return c.json(accessView(access))
  },
)

gcpProjectScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const serviceAccountId = c.get('gcpBinding').id

  await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { gcpServiceAccounts: { id: serviceAccountId } },
      $set: { updatedAt: new Date() },
    },
  )

  return c.body(null, 204)
})

gcpProjectScoped.use('*', requireGcpMemberAccess())

gcpProjectScoped.get('/', (c) => {
  return c.json({
    serviceAccountId: c.get('gcpBinding').id.toHexString(),
    projectId: c.get('projectId'),
    serviceAccountEmail: c.get('serviceAccountEmail'),
  })
})

registerGcpComputeRoutes(gcpProjectScoped)
registerGcpMonitoringRoutes(gcpProjectScoped)
registerGcpCredentialRoutes(gcpProjectScoped)
registerGkeKubeconfigRoute(gcpProjectScoped)
registerGcpCloudRunRoutes(gcpProjectScoped)
