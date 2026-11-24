// The created team's role, isolated from Mongo. `POST /teams` hands back the
// team the client adopts as active without refetching, so a response that drops
// `role` reads as "not an admin" and strands the workspace creator behind every
// admin-gated surface — the paywall most visibly.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { config } from '@/config'
import { errorHandler } from '@/lib/errors'
import { useBoxInstaboxCreate } from '@/lib/test/doubles/box-instabox-create'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useObservability } from '@/lib/test/doubles/observability'

import type { NuphosTeam } from '@/lib/identity/types'
import type { AuthVariables } from '@/middleware/auth'

const USER = '62e6289482f5f9d9408f1a79'
const TEAM = '64b5f1c2e4b0a1d2c3e4f5a6'
const EMAIL = 'member@example.com'

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

const identity = useIdentity({
  createTeamForUser: () => Promise.resolve(CREATED),
  // `getMyTeams` resolves the caller's membership, so the listing carries a role.
  getMyTeams: () => Promise.resolve([CREATED]),
})

// The free Box a first team starts (#4186): every `createBox` call, and the events logged.
const boxes: string[][] = []
// Whether each of them was to get an OpenRouter key.
const gifts: (boolean | undefined)[] = []
const events: string[] = []
const boxCreate = useBoxInstaboxCreate({
  createBox: (...args) => {
    boxes.push(args.slice(0, 3) as string[])
    gifts.push(args[3]?.openRouterGift)

    return Promise.resolve({})
  },
})

useObservability({
  logEvent: (_level, event) => {
    events.push(event)
  },
  logError: (event) => {
    events.push(event)
  },
})

const savedBox = { ...config.box }
const savedUrl = config.agent.publicBackendUrl

beforeEach(() => {
  boxes.length = 0
  gifts.length = 0
  events.length = 0
  config.box.instabox = { apiKey: 'ibk_test' }
  config.box.defaultVcpuLimit = 2
  config.box.defaultMonthlyHours = 50
  config.agent.publicBackendUrl = 'https://api.example.test'
})

afterEach(() => {
  Object.assign(config.box, savedBox)
  delete config.box.defaultMonthlyHours
  config.agent.publicBackendUrl = savedUrl
})

/** Lets the Box start that `POST /teams` does not wait for run to its end. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

const { registerTeamsRootRoutes } = await import('@/routes/teams/root')

function app(email = EMAIL) {
  const outer = new Hono<{ Variables: AuthVariables }>()

  outer.onError(errorHandler)
  outer.use('*', async (c, next) => {
    c.set('userId', USER)
    c.set('userEmail', email)
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

describe('POST /teams starts the free Box of a first team', () => {
  test('a user’s first team starts one Box, Computer 1', async () => {
    expect((await createTeam()).status).toBe(201)
    await settle()

    expect(boxes).toEqual([[USER, TEAM, 'Computer 1']])
    expect(events).toContain('agent.box.first_team_started')
  })

  test('its OpenCode is to get an OpenRouter key', async () => {
    expect((await createTeam()).status).toBe(201)
    await settle()

    expect(gifts).toEqual([true])
  })

  test('a second team the user owns starts none', async () => {
    identity({ getMyTeams: () => Promise.resolve([CREATED, { ...CREATED, id: 'other' }]) })
    expect((await createTeam()).status).toBe(201)
    await settle()

    expect(boxes).toEqual([])
  })

  test('a team the user only joined does not count as theirs', async () => {
    identity({
      getMyTeams: () =>
        Promise.resolve([CREATED, { ...CREATED, id: 'joined', ownerID: 'someone' }]),
    })
    expect((await createTeam()).status).toBe(201)
    await settle()

    expect(boxes).toEqual([[USER, TEAM, 'Computer 1']])
  })

  test('a deployment without a free Box starts none', async () => {
    delete config.box.defaultMonthlyHours
    expect((await createTeam()).status).toBe(201)
    await settle()

    expect(boxes).toEqual([])
  })

  test('the team is made, and the failure logged, when the Box cannot start', async () => {
    boxCreate({ createBox: () => Promise.reject(new Error('instabox is busy')) })
    expect((await createTeam()).status).toBe(201)
    await settle()

    expect(events).toContain('agent.box.first_team_failed')
  })

  test('the team does not wait for a Box that is slow to start', async () => {
    boxCreate({
      createBox: () =>
        new Promise(() => {
          // never settles
        }),
    })
    const started = performance.now()

    expect((await createTeam()).status).toBe(201)
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('GET /teams', () => {
  test('says whether the viewer’s email domain is a public provider', async () => {
    for (const [email, isPublic] of [
      ['bryan@gmail.com', true],
      [EMAIL, false],
    ] as const) {
      const { teams } = (await (await app(email).request('/')).json()) as { teams: TeamBody[] }

      expect(teams[0]!.viewerEmailDomainPublic).toBe(isPublic)
    }
  })
})
