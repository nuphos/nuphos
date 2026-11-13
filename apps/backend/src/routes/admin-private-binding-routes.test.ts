import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useByosAccount } from '@/lib/test/doubles/byos-account'

import { posthogIntegrationsRoutes } from './posthog-integrations'
import { tailscaleClientsRoutes } from './tailscale-clients'

import type { TeamAuthVariables } from '@/middleware/auth'

const id = new ObjectId()
const access = {
  memberAllowList: ['owner'],
  ownerUserId: 'owner',
  updatedAt: new Date(),
  updatedBy: 'owner',
}

useByosAccount({
  findPosthogIntegration: async () => ({ id, label: 'p', projects: [], access }) as never,
  findTailscaleClient: async () => ({ id, label: 't', clientId: 'c', access }) as never,
})

function app(routes: Hono<{ Variables: TeamAuthVariables }>) {
  const root = new Hono<{ Variables: TeamAuthVariables }>()

  root.use('*', async (c, next) => {
    c.set('teamId', new ObjectId().toHexString())
    c.set('userId', 'admin')
    c.set('teamRole', 'ADMINISTRATOR')
    await next()
  })
  root.route('/', routes)

  return root.onError(errorHandler)
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

test("an admin cannot use another member's private PostHog binding to list or pick projects", async () => {
  const posthog = app(posthogIntegrationsRoutes)

  expect((await posthog.request(`/${id.toHexString()}/available-projects`)).status).toBe(403)
  expect(
    (await posthog.request(`/${id.toHexString()}/projects`, json('PUT', { projectIds: [1] })))
      .status,
  ).toBe(403)
})

test("an admin cannot change another member's private Tailscale binding's sandbox access", async () => {
  const response = await app(tailscaleClientsRoutes).request(
    `/${id.toHexString()}/sandbox-access`,
    json('PUT', { enabled: true }),
  )

  expect(response.status).toBe(403)
})
