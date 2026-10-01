// The created team's role, isolated from Mongo. `POST /teams` hands back the
// team the client adopts as active without refetching, so a response that drops
// `role` reads as "not an admin" and strands the workspace creator behind every
// admin-gated surface — the paywall most visibly.
import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { NuphosTeam } from '@/lib/identity/types'
import type { AuthVariables } from '@/middleware/auth'

const USER = '62e6289482f5f9d9408f1a79'
const TEAM = '69e989027ab63e8d6a0ffcb6'
const EMAIL = 'ian@zeabur.com'

/**
 * What `createTeamForUser` resolves — role included, mirroring its contract of
 * reporting the creator's seeded membership (covered by its own unit test).
 */
const CREATED: NuphosTeam = {
  id: TEAM,
  name: 'Ian’s Workspace',
  avatarUrl: '',
  agentRuntime: 'claude-code',
  ownerID: USER,
  contactEmails: [EMAIL],
  allowedEmailDomains: [],
  createdAt: '2026-08-03T00:00:00.000Z',
  role: 'ADMINISTRATOR',
  billing: { activated: false, active: false },
}

useIdentity({
  createTeamForUser: () => Promise.resolve(CREATED),
  // `getMyTeams` resolves the caller's membership, so the listing carries a role.
  getMyTeams: () => Promise.resolve([CREATED]),
})

const { registerTeamsRootRoutes } = await import('@/routes/teams/root')

function app() {
  const outer = new Hono<{ Variables: AuthVariables }>()

  outer.onError(errorHandler)
  outer.use('*', async (c, next) => {
    c.set('userId', USER)
    c.set('userEmail', EMAIL)
    await next()
  })
  registerTeamsRootRoutes(outer)

  return outer
}

type TeamBody = Record<string, unknown>

function createTeam() {
  return app().request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ian’s Workspace' }),
  })
}

async function createdTeam(): Promise<TeamBody> {
  return ((await (await createTeam()).json()) as { team: TeamBody }).team
}

describe('POST /teams', () => {
  test('marks the creator as the team ADMINISTRATOR', async () => {
    const res = await createTeam()

    expect(res.status).toBe(201)

    const { team } = (await res.json()) as { team: TeamBody }

    expect(team.role).toBe('ADMINISTRATOR')
    expect(team.isOwner).toBe(true)
  })

  test('returns the same shape GET /teams does, so clients can adopt it as-is', async () => {
    const team = await createdTeam()
    const { teams } = (await (await app().request('/', { method: 'GET' })).json()) as {
      teams: TeamBody[]
    }

    // Field-for-field, not just `role`: the two endpoints disagreeing on the
    // Team shape is the defect class, and the next omission would be as silent.
    const fields = (body: TeamBody) => Object.keys(body).sort((a, b) => a.localeCompare(b))

    expect(fields(team)).toEqual(fields(teams[0]!))
  })
})
