import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useModels } from '@/lib/test/doubles/models'

import type { TeamAuthVariables } from '@/middleware/auth'

const TEAM_ID = new ObjectId()

type Scope = { teamId: ObjectId; userId: string }
const documents = new Map<string, string[]>()
const key = ({ teamId, userId }: Scope) => `${teamId.toHexString()}:${userId}`

useModels({
  userTeamRuntimeFallbacks: () => ({
    findOne: async (filter: Scope) => {
      const runtimeIds = documents.get(key(filter))

      return runtimeIds ? { runtimeIds } : null
    },
    updateOne: async (filter: Scope, update: { $set: { runtimeIds: string[] } }) => {
      documents.set(key(filter), update.$set.runtimeIds)
    },
    deleteOne: async (filter: Scope) => {
      documents.delete(key(filter))
    },
  }),
})

const { runtimeFallbackRoutes } = await import('@/routes/runtime-fallback')

let userId = 'user-a'
const app = new Hono<{ Variables: TeamAuthVariables }>()

app.use('*', async (c, next) => {
  c.set('teamId', TEAM_ID.toHexString())
  c.set('userId', userId)
  c.set('teamRole', 'VIEWER')
  await next()
})
app.route('/', runtimeFallbackRoutes)
app.onError(errorHandler)

const put = (runtimeIds: unknown) =>
  app.request('/', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runtimeIds }),
  })

beforeEach(() => {
  documents.clear()
  userId = 'user-a'
})

test('each member keeps their own ordered list, without repeats', async () => {
  expect(await (await put(['b', 'a', 'b'])).json()).toEqual({ runtimeIds: ['b', 'a'] })
  expect(await (await app.request('/')).json()).toEqual({ runtimeIds: ['b', 'a'] })

  userId = 'user-b'
  expect(await (await app.request('/')).json()).toEqual({ runtimeIds: [] })
})

test('an empty list turns fallback off', async () => {
  await put(['a'])
  await put([])

  expect(documents.size).toBe(0)
})

test('a malformed list is rejected', async () => {
  expect((await put('a')).status).toBe(400)
  expect((await put(Array.from({ length: 21 }, (_, i) => `r${i}`))).status).toBe(400)
})
