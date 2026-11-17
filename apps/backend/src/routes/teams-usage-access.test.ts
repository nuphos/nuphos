// Team usage, activity and stats through the real /teams router and its auth
// middleware: what each role's own token reaches. The database is a recorder,
// so each case checks whose rows the route asked for.
import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { NuphosTeamRole } from '@/lib/identity/types'

const TEAM = '64b5f1c2e4b0a1d2c3e4f5a6'
const ADMIN = '62e6289482f5f9d9408f1a79'
const MEMBER = '62e6289482f5f9d9408f1a7a'
// Stats reads are cached per member for a while, so each role is its own member.
const MEMBER_BY_ROLE = { EDITOR: MEMBER, VIEWER: '62e6289482f5f9d9408f1a7b' }

let role: NuphosTeamRole = 'VIEWER'
let caller = MEMBER
const asked: { collection: string; query: unknown }[] = []

const recorded = (collection: string) => ({
  find: (query: unknown) => {
    asked.push({ collection, query })
    const cursor = { map: () => cursor, toArray: () => Promise.resolve([]) }

    return cursor
  },
  aggregate: (pipeline: unknown) => {
    asked.push({ collection, query: pipeline })

    return { toArray: () => Promise.resolve([]) }
  },
})

useDb({ db: () => ({ collection: recorded }) })
useIdentity({
  authenticateToken: () =>
    Promise.resolve({ user: { id: caller, email: 'm@example.com', name: 'Member' } } as never),
  getTeamMembership: () => Promise.resolve({ role, team: { id: TEAM } } as never),
  getTeamMembers: () =>
    Promise.resolve([
      { id: ADMIN, name: 'Admin', avatarURL: '' },
      { id: MEMBER, name: 'Member', avatarURL: '' },
      { id: MEMBER_BY_ROLE.VIEWER, name: 'Viewer', avatarURL: '' },
    ] as never),
})

const { teamsRoutes } = await import('@/routes/teams')
// Mounted as the app mounts it, so a thrown AppError answers with its status.
const app = new Hono().onError(errorHandler).route('/teams', teamsRoutes)

const get = (path: string) =>
  app.request(`/teams/${TEAM}${path}`, { headers: { Authorization: 'Bearer session' } })

beforeEach(() => {
  asked.length = 0
})

const as = (who: string, teamRole: NuphosTeamRole) => {
  caller = who
  role = teamRole
}

describe.each(['EDITOR', 'VIEWER'] as const)('a member with %s', (teamRole) => {
  const self = MEMBER_BY_ROLE[teamRole]

  beforeEach(() => as(self, teamRole))

  test('reads only their own usage', async () => {
    expect((await get('/usage')).status).toBe(200)
    const usage = asked.filter((a) => a.collection === 'agent_token_usage')

    expect(usage.length).toBeGreaterThan(0)
    for (const { query } of usage)
      expect((query as { $match?: object }[])[0]?.$match).toMatchObject({
        teamId: TEAM,
        userId: self,
      })
  })

  test('sees only their own row of team activity', async () => {
    const response = await get('/agent-activity?range=1d')
    const body = (await response.json()) as { members: { id: string }[] }

    expect(response.status).toBe(200)
    expect(body.members.map((m) => m.id)).toEqual([self])
  })

  test('reads their own stats, and is refused the team’s', async () => {
    expect((await get('/agent-stats?scope=me')).status).toBe(200)
    expect(asked.find((a) => a.collection === 'agent_conversations')?.query).toMatchObject({
      userId: self,
    })
    expect((await get('/agent-stats?scope=team')).status).toBe(403)
  })
})

describe('an administrator', () => {
  beforeEach(() => as(ADMIN, 'ADMINISTRATOR'))

  test('reads the whole team’s usage, activity and stats', async () => {
    expect((await get('/usage')).status).toBe(200)
    expect(
      asked
        .filter((a) => a.collection === 'agent_token_usage')
        .every(({ query }) => !('userId' in ((query as { $match: object }[])[0]?.$match ?? {}))),
    ).toBe(true)

    const activity = (await (await get('/agent-activity?range=1d')).json()) as {
      members: { id: string }[]
    }

    expect(activity.members.map((m) => m.id).sort((a, b) => a.localeCompare(b))).toEqual(
      [ADMIN, MEMBER, MEMBER_BY_ROLE.VIEWER].sort((a, b) => a.localeCompare(b)),
    )
    expect((await get('/agent-stats?scope=team')).status).toBe(200)
  })
})
