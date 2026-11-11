import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { errorHandler } from '@/lib/errors'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useModels } from '@/lib/test/doubles/models'

import type { AgentVars } from '@/routes/agent-sessions/shared'

const TEAM = new ObjectId()
const OTHER_TEAM = new ObjectId()
const MEMBER = new ObjectId().toHexString()
const BINDING = new ObjectId()
let selected: string[] | undefined
let allowList: string[] | undefined
let calls: { url: string; body: unknown }[]
let currentTeam = TEAM
let remoteStatus = 'ACTIVE'
const realFetch = globalThis.fetch
const saved = { ...config.byos.composio }

useModels({
  teamByosBindings: () => ({
    findOne: async (filter: { _id: ObjectId }) =>
      filter._id.equals(TEAM)
        ? {
            _id: TEAM,
            trelloIntegrations: [
              {
                id: BINDING,
                label: 'Fixture account',
                username: 'fixture',
                memberId: 'member',
                authorizedBy: MEMBER,
                composioAccountId: 'ca_fixture',
                composioUserId: `${TEAM.toHexString()}:${MEMBER}`,
                createdAt: new Date(),
                access: { memberAllowList: allowList, updatedAt: new Date(), updatedBy: MEMBER },
              },
            ],
          }
        : null,
  }),
})
useAgentSessionsShared({
  getAgentCredentialAccess: async () => ({ trelloIntegrationIds: selected }),
})
const { trelloScoped } = await import('./trello')

beforeEach(() => {
  selected = [BINDING.toHexString()]
  allowList = [MEMBER]
  currentTeam = TEAM
  remoteStatus = 'ACTIVE'
  calls = []
  Object.assign(config.byos.composio, { apiKey: 'fixture-key', trelloAuthConfigId: 'ac_trello' })
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })

    return new Response(
      JSON.stringify(
        calls.length === 1
          ? {
              status: remoteStatus,
              user_id: `${TEAM.toHexString()}:${MEMBER}`,
              toolkit: { slug: 'trello' },
              auth_config: { id: 'ac_trello' },
            }
          : { successful: true, data: [{ id: 'fixture-board' }] },
      ),
    )
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  Object.assign(config.byos.composio, saved)
})

function execute(
  body: unknown = { tool: 'TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER', arguments: { idMember: 'me' } },
) {
  const app = new Hono<{ Variables: AgentVars }>()

  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('teamId' as never, currentTeam.toHexString() as never)
    c.set('userId', MEMBER)
    c.set('agent', { userId: MEMBER, sessionId: 'fixture-session' } as AgentVars['agent'])
    await next()
  })
  app.route('/trello-integrations/:integrationId', trelloScoped)

  return app.request(`/trello-integrations/${BINDING.toHexString()}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('session-scoped Trello execution', () => {
  test('uses the saved account and authorizing identity, without handing out credentials', async () => {
    const response = await execute()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(await response.text()).not.toContain('fixture-key')
    expect(calls[1]?.body).toMatchObject({
      connected_account_id: 'ca_fixture',
      user_id: `${TEAM.toHexString()}:${MEMBER}`,
    })
  })
  test.each([{ value: [] }, { value: undefined }])(
    'denies missing and empty selection before Composio',
    async ({ value }) => {
      selected = value === undefined ? undefined : [...value]
      expect((await execute()).status).toBe(403)
      expect(calls).toHaveLength(0)
    },
  )
  test('denies member access removed after selection', async () => {
    allowList = []
    expect((await execute()).status).toBe(403)
    expect(calls).toHaveLength(0)
  })
  test('a missing allow-list fails closed', async () => {
    allowList = undefined
    expect((await execute()).status).toBe(403)
    expect(calls).toHaveLength(0)
  })
  test('does not look up a binding in another team', async () => {
    currentTeam = OTHER_TEAM
    expect((await execute()).status).toBe(404)
    expect(calls).toHaveLength(0)
  })
  test('refuses caller-chosen connected account or execution identity', async () => {
    expect(
      (await execute({ tool: 'TRELLO_ADD_CARDS', arguments: {}, connectedAccountId: 'ca_other' }))
        .status,
    ).toBe(400)
    expect(calls).toHaveLength(0)
  })
  test('revoked Composio accounts fail closed without tool execution', async () => {
    remoteStatus = 'EXPIRED'
    expect((await execute()).status).toBe(403)
    expect(calls).toHaveLength(1)
  })
})
