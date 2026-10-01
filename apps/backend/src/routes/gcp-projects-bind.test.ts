import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useByosGcp } from '@/lib/test/doubles/byos-gcp'
import { useByosGcpWif } from '@/lib/test/doubles/byos-gcp-wif'
import { useModels } from '@/lib/test/doubles/models'

import type { TeamAuthVariables } from '@/middleware/auth'

useByosGcp({
  impersonateSa: async () => ({ getAccessToken: async () => ({ token: 'test-token' }) }),
})

useByosGcpWif({
  gcpWifConfigured: () => true,
})

const TEAM_ID = new ObjectId()
const PROJECT = 'robotic-almanac-213113'
const ADMIN_SA = 'nuphos-permission-admin@robotic-almanac-213113.iam.gserviceaccount.com'

const stored: { gcpServiceAccounts: unknown[] } = { gcpServiceAccounts: [] }

useModels({
  teamByosBindings: () => ({
    findOne: async () => stored,
    updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
  }),
})

// The bind route asks the entitlement layer for headroom first, and the final
// append re-checks it under the write lock. These suites are about the write,
// not billing, so hand them a grandfathered workspace — the one population
// that resolves to "no limit" regardless of whether Stripe is configured, so

const { gcpProjectsRoutes } = await import('@/routes/gcp-projects')

const app = new Hono<{ Variables: TeamAuthVariables }>()

app.onError(errorHandler)
app.use('*', async (c, next) => {
  c.set('teamId', TEAM_ID.toHexString())
  c.set('userId', 'admin-user')
  c.set('teamRole', 'ADMINISTRATOR')
  await next()
})
app.route('/', gcpProjectsRoutes)

test('retired permission-admin connections are rejected before cloud setup or persistence', async () => {
  const response = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceAccountEmail: ADMIN_SA,
      projectId: PROJECT,
      purpose: 'permission-admin',
    }),
  })

  expect(response.status).toBe(400)
})
