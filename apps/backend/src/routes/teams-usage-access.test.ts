// Team usage, activity and stats through the real /teams router and its auth
// middleware: what each role's own token reaches. The database is a recorder,
// so each case checks whose rows the route asked for.
import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { NuphosTeamRole } from '@/lib/identity/types'

const TEAM = '64b5f1c2e4b0a1d2c3e4f5a6'
const ADMIN = '62e6289482f5f9d9408f1a79'
const MEMBER = '62e6289482f5f9d9408f1a7a'

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
    ] as never),
})

const { teamsRoutes } = await import('@/routes/teams')

const get = (path: string) =>
  teamsRoutes.request(`/${TEAM}${path}`, { headers: { Authorization: 'Bearer session' } })

beforeEach(() => {
  asked.length = 0
})

const as = (who: string, teamRole: NuphosTeamRole) => {
  caller = who
  role = teamRole
}

describe.each(['EDITOR', 'VIEWER'] as const)('a member with %s', (teamRole) => {
  beforeEach(() => as(MEMBER, teamRole))

  test('reads only their own usage', async () => {
    expect((await get('/usage')).status).toBe(200)
    const usage = asked.filter((a) => a.collection === 'agent_token_usage')

    expect(usage.length).toBeGreaterThan(0)
    for (const { query } of usage)
      expect((query as { $match?: object }[])[0]?.$match).toMatchObject({
        teamId: TEAM,
        userId: MEMBER,
      })
  })

  test('sees only their own row of team activity', async () => {
    const response = await get('/agent-activity?range=1d')
    const body = (await response.json()) as { members: { id: string }[] }

    expect(response.status).toBe(200)
    expect(body.members.map((m) => m.id)).toEqual([MEMBER])
  })

  test('reads their own stats, and is refused the team’s', async () => {
    expect((await get('/agent-stats?scope=me')).status).toBe(200)
    expect(asked.find((a) => a.collection === 'agent_conversations')?.query).toMatchObject({
      userId: MEMBER,
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
      [ADMIN, MEMBER].sort((a, b) => a.localeCompare(b)),
    )
    expect((await get('/agent-stats?scope=team')).status).toBe(200)
  })
})
