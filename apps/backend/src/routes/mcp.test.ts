import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { inTokenTeamScope } from '@/lib/identity/token-team-scope'
import { hashToken } from '@/lib/oauth/tokens'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { FakeCoordinationStore } from '@/lib/test/fake-coordination-store'

const USER = { id: '507f1f77bcf86cd799439011', email: 'ada@example.com', name: 'Ada' }
const BOT = 'nup_bot-token'
const PERSONAL = 'nup_personal-token'
const store = new FakeCoordinationStore()

useDb({ db: () => ({ collection: store.collection }) })
useIdentity({
  getNuphosUserForCredential: async (id) => (id === USER.id ? USER : null) as never,
  // The real list drops teams outside an agent token's scope the same way.
  getMyTeams: async () =>
    [
      { id: 't1', name: 'One' },
      { id: 't2', name: 'Two' },
    ].filter((team) => inTokenTeamScope(team.id)) as never,
})

const { mcp } = await import('./mcp')

const listTeams = (token: string) =>
  mcp.request('/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'nuphos_list_teams', arguments: {} },
    }),
  })

const teamIds = async (response: Response) => {
  const { result } = (await response.json()) as {
    result: { structuredContent: { teams: { team_id: string }[] } }
  }

  return result.structuredContent.teams.map((team) => team.team_id)
}

beforeEach(() => {
  store.rows = {
    cli_tokens: [
      {
        _id: new ObjectId(),
        secretHash: hashToken(BOT),
        kind: 'agent',
        userId: USER.id,
        teamId: 't1',
        name: 'Deploy Bot',
        createdAt: new Date(),
      },
      {
        _id: new ObjectId(),
        secretHash: hashToken(PERSONAL),
        kind: 'personal',
        userId: USER.id,
        name: 'laptop',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    ],
  }
})

test("a Bot's agent token signs in to /mcp and reaches its own team only", async () => {
  const response = await listTeams(BOT)

  expect(response.status).toBe(200)
  expect(await teamIds(response)).toEqual(['t1'])
})

test('a personal CLI token acts as its person', async () => {
  expect(await teamIds(await listTeams(PERSONAL))).toEqual(['t1', 't2'])
})

test('an unknown or revoked CLI token gets the OAuth challenge', async () => {
  store.rows.cli_tokens = []
  const response = await listTeams(BOT)

  expect(response.status).toBe(401)
  expect(response.headers.get('WWW-Authenticate')).toContain('error="invalid_token"')
})
