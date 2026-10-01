import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useModels } from '@/lib/test/doubles/models'

import type { AuthVariables, TeamAuthVariables } from '@/middleware/auth'
import type { UserTeamSidebarFavorites } from '@/models'

const TEAM_ID = new ObjectId()
const documents = new Map<string, UserTeamSidebarFavorites>()
let currentUserId = 'user-a'

function documentKey(teamId: ObjectId, userId: string): string {
  return `${teamId.toHexString()}:${userId}`
}

const collection = {
  findOne: async (filter: { teamId: ObjectId; userId: string }) =>
    documents.get(documentKey(filter.teamId, filter.userId)) ?? null,
  insertOne: async (doc: UserTeamSidebarFavorites) => {
    documents.set(documentKey(doc.teamId, doc.userId), structuredClone(doc))

    return { acknowledged: true, insertedId: doc._id }
  },
  findOneAndUpdate: async (
    filter: { teamId: ObjectId; userId: string; revision: number },
    update: {
      $set: Pick<UserTeamSidebarFavorites, 'entries' | 'updatedAt'>
      $inc: { revision: number }
    },
  ) => {
    const key = documentKey(filter.teamId, filter.userId)
    const current = documents.get(key)

    if (!current || current.revision !== filter.revision) return null
    const next = {
      ...current,
      ...update.$set,
      revision: current.revision + update.$inc.revision,
    }

    documents.set(key, structuredClone(next))

    return next
  },
}

useModels({
  userTeamSidebarFavorites: () => collection as never,
})
useIdentity({
  getTeamMembership: async (userId) =>
    userId === 'member-user'
      ? ({
          role: 'VIEWER',
          team: { id: TEAM_ID.toHexString(), ownerID: 'owner', billing: { active: true } },
        } as never)
      : null,
})

const { sidebarFavoritesRoutes } = await import('@/routes/sidebar-favorites')
const { requireTeamMember } = await import('@/middleware/auth')
const app = new Hono<{ Variables: TeamAuthVariables }>()

app.use('*', async (c, next) => {
  c.set('teamId', TEAM_ID.toHexString())
  c.set('userId', currentUserId)
  await next()
})
app.route('/', sidebarFavoritesRoutes)
app.onError(errorHandler)

const securedApp = new Hono<{ Variables: AuthVariables }>()
const securedTeam = new Hono<{ Variables: TeamAuthVariables }>()

securedApp.use('*', async (c, next) => {
  c.set('userId', currentUserId)
  await next()
})
securedTeam.use('*', requireTeamMember())
securedTeam.route('/favorites', sidebarFavoritesRoutes)
securedApp.route('/:teamId', securedTeam)
securedApp.onError(errorHandler)

async function replace(expectedRevision: number, entries: unknown[]) {
  return app.request('/', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision, entries }),
  })
}

beforeEach(() => {
  documents.clear()
  currentUserId = 'user-a'
})

describe('sidebar favorites API', () => {
  test('requires membership in the requested team before reading personal data', async () => {
    currentUserId = 'outsider-user'
    const forbidden = await securedApp.request(`/${TEAM_ID.toHexString()}/favorites`)

    expect(forbidden.status).toBe(403)
    currentUserId = 'member-user'
    const allowed = await securedApp.request(`/${TEAM_ID.toHexString()}/favorites`)

    expect(allowed.status).toBe(200)
  })

  test('starts empty and creates a revisioned personal list', async () => {
    const empty = await app.request('/')

    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual({ entries: [], revision: 0, updatedAt: null })

    const created = await replace(0, [{ label: 'Pods', key: 'workloads.pods' }])
    const body = (await created.json()) as { entries: unknown[]; revision: number }

    expect(created.status).toBe(200)
    expect(body.revision).toBe(1)
    expect(body.entries).toEqual([{ label: 'Pods', key: 'workloads.pods' }])
  })

  test('isolates the same team by authenticated user id', async () => {
    await replace(0, [{ label: 'User A', key: 'a' }])
    currentUserId = 'user-b'

    const emptyForB = await app.request('/')

    expect(await emptyForB.json()).toEqual({ entries: [], revision: 0, updatedAt: null })
    await replace(0, [{ label: 'User B', key: 'b' }])
    currentUserId = 'user-a'

    const stillA = await app.request('/')
    const body = (await stillA.json()) as { entries: unknown[] }

    expect(body.entries).toEqual([{ label: 'User A', key: 'a' }])
  })

  test('rejects stale replacement revisions without overwriting the winner', async () => {
    await replace(0, [{ label: 'Initial', key: 'initial' }])
    const winner = await replace(1, [{ label: 'Winner', key: 'winner' }])

    expect(winner.status).toBe(200)
    const stale = await replace(1, [{ label: 'Stale', key: 'stale' }])
    const error = (await stale.json()) as { error: { code: string; details: { revision: number } } }

    expect(stale.status).toBe(409)
    expect(error.error.code).toBe('sidebar_favorites_changed')
    expect(error.error.details.revision).toBe(2)
    const current = (await (await app.request('/')).json()) as { entries: unknown[] }

    expect(current.entries).toEqual([{ label: 'Winner', key: 'winner' }])
  })

  test('validates identity shape and duplicate identities', async () => {
    const invalid = await replace(0, [
      { label: 'Both', key: 'same', href: '/same' },
      { label: 'One', key: 'duplicate' },
      { label: 'Two', key: 'duplicate' },
    ])

    expect(invalid.status).toBe(400)
    expect(documents.size).toBe(0)
  })
})
