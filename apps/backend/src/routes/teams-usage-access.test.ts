// Team usage, activity and stats through the real app, /teams router and its auth
// middleware: what each role's own token reaches. The database is a recorder,
// so each case checks whose rows the route asked for.
import { beforeEach, describe, expect, test } from 'bun:test'

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

// Each member ran one session an hour ago, so the activity has a titled session per row.
const ranAt = Date.now() - 60 * 60_000
const OWNERS = { [ADMIN]: 'Admin', [MEMBER]: 'Editor', [MEMBER_BY_ROLE.VIEWER]: 'Viewer' }
const seeded: Record<string, unknown[]> = {
  agent_conversations: Object.entries(OWNERS).map(([userId, name]) => ({
    sessionId: `s-${userId}`,
    userId,
    title: `${name} work`,
  })),
  agent_messages: Object.keys(OWNERS).flatMap((userId) => [
    { sessionId: `s-${userId}`, role: 'user', createdAt: new Date(ranAt) },
    { sessionId: `s-${userId}`, role: 'assistant', createdAt: new Date(ranAt + 60_000) },
  ]),
}

const recorded = (collection: string) => ({
  find: (query: unknown) => {
    asked.push({ collection, query })
    let rows = seeded[collection] ?? []
    const cursor = {
      map: (fn: (row: unknown) => unknown) => {
        rows = rows.map(fn)

        return cursor
      },
      toArray: () => Promise.resolve(rows),
    }

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

// The whole app, so the route answers as it does in production; loading it
// also gives this suite its own process in CI.
const { app } = await import('@/index-app')

const get = (path: string) =>
  app.request(`/teams/${TEAM}${path}`, { headers: { Authorization: 'Bearer session' } })

beforeEach(() => {
  asked.length = 0
})

type Activity = { members: { id: string }[]; sessions: { id: string; title: string | null }[] }

const titles = (activity: Activity) =>
  Object.fromEntries(activity.sessions.map((s) => [s.id, s.title]))

const as = (who: string, teamRole: NuphosTeamRole) => {
  caller = who
  role = teamRole
}

describe.each(['EDITOR', 'VIEWER'] as const)('a member with %s', (teamRole) => {
  const self = MEMBER_BY_ROLE[teamRole]

  beforeEach(() => as(self, teamRole))

  test('reads the whole team’s usage, as an administrator does', async () => {
    expect((await get('/usage')).status).toBe(200)
    const usage = asked.filter((a) => a.collection === 'agent_token_usage')

    expect(usage.length).toBeGreaterThan(0)
    for (const { query } of usage) {
      const match = (query as { $match?: Record<string, unknown> }[])[0]?.$match

      expect(match).toMatchObject({ teamId: TEAM })
      expect(match).not.toHaveProperty('userId')
    }
  })

  test("sees every member's activity, with only their own sessions titled", async () => {
    const response = await get('/agent-activity?range=1d')
    const body = (await response.json()) as Activity

    expect(response.status).toBe(200)
    expect(new Set(body.members.map((m) => m.id))).toEqual(new Set(Object.keys(OWNERS)))
    expect(titles(body)).toEqual({
      [`s-${ADMIN}`]: null,
      [`s-${MEMBER}`]: self === MEMBER ? 'Editor work' : null,
      [`s-${MEMBER_BY_ROLE.VIEWER}`]: self === MEMBER ? null : 'Viewer work',
    })
  })

  test('reads their own stats and the whole team’s', async () => {
    expect((await get('/agent-stats?scope=me')).status).toBe(200)
    expect(asked.find((a) => a.collection === 'agent_conversations')?.query).toMatchObject({
      userId: self,
    })
    expect((await get('/agent-stats?scope=team')).status).toBe(200)
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

    const activity = (await (await get('/agent-activity?range=1d')).json()) as Activity

    expect(activity.members.map((m) => m.id).sort((a, b) => a.localeCompare(b))).toEqual(
      [ADMIN, MEMBER, MEMBER_BY_ROLE.VIEWER].sort((a, b) => a.localeCompare(b)),
    )
    expect(titles(activity)).toEqual({
      [`s-${ADMIN}`]: 'Admin work',
      [`s-${MEMBER}`]: 'Editor work',
      [`s-${MEMBER_BY_ROLE.VIEWER}`]: 'Viewer work',
    })
    expect(titles(activity)).toEqual({
      [`s-${ADMIN}`]: 'Admin work',
      [`s-${MEMBER}`]: 'Editor work',
      [`s-${MEMBER_BY_ROLE.VIEWER}`]: 'Viewer work',
    })
    expect((await get('/agent-stats?scope=team')).status).toBe(200)
  })
})
