import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { useModels } from '@/lib/test/doubles/models'

import type { DashboardPanel, NuphosDashboard } from '@/models'

const A = 'a1'.repeat(12)
const B = 'b2'.repeat(12)
const now = new Date('2026-01-01T00:00:00.000Z')
const teamId = new ObjectId()
const dashboard = {
  _id: new ObjectId(),
  teamId,
  name: 'Spend',
  layout: [],
  timeRange: { periodStart: now, periodEnd: now },
  visibility: 'team',
  createdBy: 'creator',
  createdAt: now,
  updatedAt: now,
} as unknown as NuphosDashboard
const panel = {
  _id: new ObjectId(),
  teamId,
  dashboardId: dashboard._id,
  title: 'Spend',
  kind: 'scalar',
  scriptVersion: 1,
  versions: [],
  credentialAccess: {
    personalCredentialIds: ['github'],
    personalConnectionIds: [A, B],
    updatedAt: now,
    updatedBy: 'creator',
  },
  createdBy: 'creator',
  createdAt: now,
  updatedAt: now,
} as unknown as DashboardPanel

useModels({
  nuphosDashboards: () => ({ findOne: () => Promise.resolve(dashboard) }) as never,
  dashboardPanels: () => ({ find: () => ({ toArray: () => Promise.resolve([panel]) }) }) as never,
  dashboardPanelSnapshots: () =>
    ({
      find: () => ({ sort: () => ({ limit: () => ({ next: () => Promise.resolve(null) }) }) }),
    }) as never,
})

const { nuphosDashboardsRoutes } = await import('@/routes/dashboards')

const app = new Hono()

app.use('*', async (c, next) => {
  c.set('userId' as never, c.req.header('x-user') as never)
  c.set('teamId' as never, teamId.toHexString() as never)
  c.set('teamRole' as never, 'MEMBER' as never)
  await next()
})
app.route('/', nuphosDashboardsRoutes)

async function read(user: string) {
  const res = await app.request(`/${dashboard._id.toHexString()}`, { headers: { 'x-user': user } })

  expect(res.status).toBe(200)
  const text = await res.text()

  return { text, access: JSON.parse(text).panels[0].credentialAccess as Record<string, unknown> }
}

test('the panel creator reads which personal accounts it names', async () => {
  const { access } = await read('creator')

  expect(access.personalConnectionIds).toEqual([A, B])
})

test('another member reads only how many, with no id anywhere in the response', async () => {
  const { text, access } = await read('teammate')

  expect(access.personalAccountCount).toBe(2)
  expect(access.personalCredentialIds).toEqual(['github'])
  expect('personalConnectionIds' in access).toBe(false)
  expect(text).not.toContain(A)
  expect(text).not.toContain(B)
})
