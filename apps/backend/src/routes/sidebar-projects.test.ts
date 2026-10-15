import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useModels } from '@/lib/test/doubles/models'

import type { AuthVariables, TeamAuthVariables } from '@/middleware/auth'
import type { UserTeamSidebarProjects } from '@/models'

const TEAM_ID = new ObjectId()
const documents = new Map<string, UserTeamSidebarProjects>()
let currentUserId = 'user-a'

function documentKey(teamId: ObjectId, userId: string): string {
  return `${teamId.toHexString()}:${userId}`
}

const collection = {
  findOne: async (filter: { teamId: ObjectId; userId: string }) =>
    documents.get(documentKey(filter.teamId, filter.userId)) ?? null,
  insertOne: async (doc: UserTeamSidebarProjects) => {
    documents.set(documentKey(doc.teamId, doc.userId), structuredClone(doc))

    return { acknowledged: true, insertedId: doc._id }
  },
  findOneAndUpdate: async (
    filter: { teamId: ObjectId; userId: string; revision: number },
    update: {
      $set: Pick<UserTeamSidebarProjects, 'projects' | 'updatedAt'>
      $inc: { revision: number }
    },
  ) => {
    const key = documentKey(filter.teamId, filter.userId)
    const current = documents.get(key)

    if (!current || current.revision !== filter.revision) return null
    const next = { ...current, ...update.$set, revision: current.revision + update.$inc.revision }

    documents.set(key, structuredClone(next))

    return next
  },
}

useModels({
  userTeamSidebarProjects: () => collection as never,
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

const { sidebarProjectsRoutes } = await import('@/routes/sidebar-projects')
const { requireTeamMember } = await import('@/middleware/auth')
const app = new Hono<{ Variables: TeamAuthVariables }>()

app.use('*', async (c, next) => {
  c.set('teamId', TEAM_ID.toHexString())
  c.set('userId', currentUserId)
  await next()
})
app.route('/', sidebarProjectsRoutes)
app.onError(errorHandler)

const securedApp = new Hono<{ Variables: AuthVariables }>()
const securedTeam = new Hono<{ Variables: TeamAuthVariables }>()

securedApp.use('*', async (c, next) => {
  c.set('userId', currentUserId)
  await next()
})
securedTeam.use('*', requireTeamMember())
securedTeam.route('/sidebar-projects', sidebarProjectsRoutes)
securedApp.route('/:teamId', securedTeam)
securedApp.onError(errorHandler)

async function replace(expectedRevision: number, projects: unknown[]) {
  return app.request('/', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision, projects }),
  })
}

const infra = { id: 'p1', name: 'Infra', sessionIds: ['s1', 's2'] }

beforeEach(() => {
  documents.clear()
  currentUserId = 'user-a'
})

describe('sidebar projects API', () => {
  test('requires membership in the requested team', async () => {
    currentUserId = 'outsider-user'
    expect((await securedApp.request(`/${TEAM_ID.toHexString()}/sidebar-projects`)).status).toBe(
      403,
    )
    currentUserId = 'member-user'
    expect((await securedApp.request(`/${TEAM_ID.toHexString()}/sidebar-projects`)).status).toBe(
      200,
    )
  })

  test('starts empty and saves a revisioned personal list', async () => {
    expect(await (await app.request('/')).json()).toEqual({
      projects: [],
      revision: 0,
      updatedAt: null,
    })
    const saved = await replace(0, [infra])
    const body = (await saved.json()) as { projects: unknown[]; revision: number }

    expect(saved.status).toBe(200)
    expect(body).toMatchObject({ projects: [infra], revision: 1 })
  })

  test('keeps the order of projects and of the chats a person arranged by hand', async () => {
    const web = { id: 'p2', name: 'Web', sessionIds: ['s4', 's3'], manualOrder: true }
    const saved = await replace(0, [web, infra])

    expect(((await saved.json()) as { projects: unknown[] }).projects).toEqual([web, infra])
  })

  test('keeps each person’s projects separate within a team', async () => {
    await replace(0, [infra])
    currentUserId = 'user-b'
    expect(((await (await app.request('/')).json()) as { projects: unknown[] }).projects).toEqual(
      [],
    )
  })

  test('rejects a stale revision and returns the current list', async () => {
    await replace(0, [infra])
    await replace(1, [{ ...infra, name: 'Winner' }])
    const stale = await replace(1, [{ ...infra, name: 'Stale' }])
    const error = (await stale.json()) as {
      error: { code: string; details: { revision: number; projects: { name: string }[] } }
    }

    expect(stale.status).toBe(409)
    expect(error.error.code).toBe('sidebar_projects_changed')
    expect(error.error.details.revision).toBe(2)
    expect(error.error.details.projects[0]?.name).toBe('Winner')
  })

  test('rejects duplicate ids, a chat filed twice, and blank names', async () => {
    for (const projects of [
      [infra, { ...infra, sessionIds: [] }],
      [infra, { id: 'p2', name: 'Other', sessionIds: ['s2'] }],
      [{ ...infra, name: '   ' }],
    ]) {
      expect((await replace(0, projects)).status).toBe(400)
    }
    expect(documents.size).toBe(0)
  })
})
