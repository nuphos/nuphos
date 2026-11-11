import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'

import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'

import { botImportRoutes as agent } from './routes-bot-imports'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const caller = 'bbbbbbbbbbbbbbbbbbbbbbbb'
let member = true
let reads = 0
let writes = 0

useIdentity({
  authenticateToken: async () => ({ user: { id: caller } }),
  getTeamMembership: async (_user, team) => (team === teamId && member ? { role: 'MEMBER' } : null),
})
useRuntimeCatalog({
  requireRuntimeInstance: async (_team, id) => ({
    id,
    provider: 'codex',
    status: 'active',
    kind: 'external',
    label: 'Fixture agent',
  }),
})
useDb({
  db: () => ({
    collection: () => ({
      findOne: async () => {
        reads++

        return null
      },
      updateOne: async () => {
        writes++

        return { matchedCount: 0 }
      },
    }),
  }),
})
const app = new Hono().route('/agent', agent)

app.onError(errorHandler)
beforeEach(() => {
  member = true
  reads = 0
  writes = 0
})
const query = `?teamId=${teamId}&runtimeId=fixture&agentRuntime=codex`
const request = (path: string, body: string, type = 'application/json') =>
  app.request(`/agent/bot-imports/${path}${query}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': type },
    body,
  })

test('a nonmember cannot upload data or claim a batch', async () => {
  member = false
  expect((await request('preview', 'not a ZIP', 'application/zip')).status).toBe(400)
  expect(reads).toBe(0)
  expect(writes).toBe(0)
})

test('invalid ZIP content is rejected before staging and errors do not echo the upload', async () => {
  const response = await request('preview', 'not a ZIP: synthetic private note', 'application/zip')

  expect(response.status).toBe(400)
  expect(await response.text()).not.toContain('synthetic private note')
  expect(reads).toBe(0)
  expect(writes).toBe(0)
})

test('schedule activation without confirmation cannot read or modify a batch', async () => {
  const response = await request(
    'some-batch/apply',
    JSON.stringify({ botKeys: ['research'], chatKeys: [], enableSchedules: true }),
  )

  expect(response.status).toBe(400)
  expect(reads).toBe(0)
  expect(writes).toBe(0)
})

test('unknown principal, runtime or source selection fields are rejected', async () => {
  const response = await request(
    'some-batch/apply',
    JSON.stringify({ botKeys: [], chatKeys: [], enableSchedules: false, userId: 'another-person' }),
  )

  expect(response.status).toBe(400)
  expect(reads).toBe(0)
  expect(writes).toBe(0)
})

test('import auth does not gate sibling /agent routes such as device runtime tunnels', async () => {
  const shared = new Hono().route('/agent', agent).route(
    '/agent',
    new Hono().get('/devices/d/runtime-tunnel', (c) => c.text('tunnel')),
  )

  shared.onError(errorHandler)
  expect((await shared.request('/agent/devices/d/runtime-tunnel')).status).toBe(200)
  expect((await shared.request('/agent/bot-imports/export-skill')).status).toBe(401)
})
