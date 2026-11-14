import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { deviceAccessDeps } from '@/lib/agent/devices/box-access'
import { errorHandler } from '@/lib/errors'
import { useModels } from '@/lib/test/doubles/models'

import type { NuphosTeamRole } from '@/lib/identity'
import type { TeamAuthVariables } from '@/middleware/auth'

const TEAM_ID = new ObjectId()
// The default Claude Code on `laptop`, a computer `owner` owns.
const LAPTOP = 'local_owner_laptop'

type Scope = { teamId: ObjectId; runtimeId: string }
const documents = new Map<string, string>()

useModels({
  teamRuntimeFallbacks: () => ({
    find: () => ({
      toArray: async () =>
        [...documents].map(([runtimeId, fallbackRuntimeId]) => ({ runtimeId, fallbackRuntimeId })),
    }),
    updateOne: async (filter: Scope, update: { $set: { fallbackRuntimeId: string } }) => {
      documents.set(filter.runtimeId, update.$set.fallbackRuntimeId)
    },
    deleteOne: async (filter: Scope) => {
      documents.delete(filter.runtimeId)
    },
  }),
})

const { runtimeFallbackRoutes } = await import('@/routes/runtime-fallback')

let userId = 'owner'
let teamRole: NuphosTeamRole = 'EDITOR'
const app = new Hono<{ Variables: TeamAuthVariables }>()

app.use('*', async (c, next) => {
  c.set('teamId', TEAM_ID.toHexString())
  c.set('userId', userId)
  c.set('teamRole', teamRole)
  await next()
})
app.route('/', runtimeFallbackRoutes)
app.onError(errorHandler)

const put = (runtimeId: string, fallbackRuntimeId: unknown) =>
  app.request(`/${runtimeId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fallbackRuntimeId }),
  })

const originalAccessDeps = { ...deviceAccessDeps }

beforeEach(() => {
  documents.clear()
  userId = 'owner'
  teamRole = 'EDITOR'
  Object.assign(deviceAccessDeps, {
    getDevice: async (actorId: string) =>
      actorId === 'owner' ? { userId: 'owner', deviceId: 'laptop' } : null,
    listBoxes: async () => [],
    findGranted: async () => [],
    role: async () => 'EDITOR',
  })
})

afterEach(() => Object.assign(deviceAccessDeps, originalAccessDeps))

test('every member reads the team’s fallbacks, one per runtime', async () => {
  expect((await put(LAPTOP, 'team-runtime')).status).toBe(200)

  userId = 'teammate'
  expect(await (await app.request('/')).json()).toEqual({
    fallbacks: { [LAPTOP]: 'team-runtime' },
  })
})

test('a computer’s fallback is set by those who manage it, not by a team role', async () => {
  userId = 'teammate'
  teamRole = 'ADMINISTRATOR'

  expect((await put(LAPTOP, 'team-runtime')).status).toBe(404)
  expect(documents.size).toBe(0)
})

test('a team runtime’s fallback is set by an administrator', async () => {
  expect((await put('team-runtime', LAPTOP)).status).toBe(403)

  teamRole = 'ADMINISTRATOR'
  expect((await put('team-runtime', LAPTOP)).status).toBe(200)
  expect(documents.get('team-runtime')).toBe(LAPTOP)
})

test('null clears a fallback; an agent cannot be its own', async () => {
  await put(LAPTOP, 'team-runtime')
  await put(LAPTOP, null)

  expect(documents.size).toBe(0)
  expect((await put(LAPTOP, LAPTOP)).status).toBe(400)
  expect((await put(LAPTOP, 3)).status).toBe(400)
})
