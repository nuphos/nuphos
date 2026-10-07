import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useModels } from '@/lib/test/doubles/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { HomeLayout } from '@/models'

const TEAM_ID = new ObjectId()
const OTHER_TEAM = new ObjectId()

type Scope = { teamId: ObjectId; userId: string | null }
const documents = new Map<string, { teamId: ObjectId; userId: string | null; layout: HomeLayout }>()
const key = ({ teamId, userId }: Scope) => `${teamId.toHexString()}:${userId ?? '<team>'}`

useModels({
  teamHomeLayouts: () => ({
    find: (filter: { teamId: ObjectId; userId: { $in: (string | null)[] } }) => ({
      toArray: async () =>
        [...documents.values()].filter(
          (d) => d.teamId.equals(filter.teamId) && filter.userId.$in.includes(d.userId),
        ),
    }),
    updateOne: async (filter: Scope, update: { $set: { layout: HomeLayout } }) => {
      documents.set(key(filter), { ...filter, layout: update.$set.layout })
    },
    deleteOne: async (filter: Scope) => {
      documents.delete(key(filter))
    },
  }),
})

const { homeLayoutRoutes } = await import('@/routes/home-layout')

let userId = 'user-a'
let role: 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER' = 'VIEWER'
const app = new Hono<{ Variables: TeamAuthVariables }>()

app.use('*', async (c, next) => {
  c.set('teamId', TEAM_ID.toHexString())
  c.set('userId', userId)
  c.set('teamRole', role)
  await next()
})
app.route('/', homeLayoutRoutes)
app.onError(errorHandler)

const layout = (team: boolean): HomeLayout => ({
  team,
  pulls: [{ installationId: 1, fullName: 'nuphos/nuphos' }],
  ci: [],
  panels: [{ dashboardId: 'd1', panelId: 'p1' }],
})

const put = (scope: 'personal' | 'team', body: unknown) =>
  app.request(`/${scope}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const get = async () => (await app.request('/')).json()

beforeEach(() => {
  documents.clear()
  userId = 'user-a'
  role = 'VIEWER'
})

test('a member sees the team default until they save their own layout', async () => {
  role = 'ADMINISTRATOR'
  expect((await put('team', { layout: layout(true) })).status).toBe(204)
  role = 'VIEWER'

  expect(await get()).toEqual({ personal: null, team: layout(true) })

  expect((await put('personal', { layout: layout(false) })).status).toBe(204)
  expect(await get()).toEqual({ personal: layout(false), team: layout(true) })

  userId = 'user-b'
  expect(await get()).toEqual({ personal: null, team: layout(true) })
})

test('a null layout resets to the team default', async () => {
  await put('personal', { layout: layout(false) })
  await put('personal', { layout: null })

  expect(await get()).toEqual({ personal: null, team: null })
})

test('only administrators set the team default', async () => {
  role = 'EDITOR'

  expect((await put('team', { layout: layout(true) })).status).toBe(403)
  expect(await get()).toEqual({ personal: null, team: null })
})

test('layouts stay inside their team', async () => {
  documents.set(key({ teamId: OTHER_TEAM, userId: null }), {
    teamId: OTHER_TEAM,
    userId: null,
    layout: layout(true),
  })

  expect(await get()).toEqual({ personal: null, team: null })
})

test('a malformed layout is rejected', async () => {
  const res = await put('personal', { layout: { team: true, pulls: 'nope', ci: [], panels: [] } })

  expect(res.status).toBe(400)
})
