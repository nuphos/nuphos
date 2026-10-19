import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import type { AgentVars } from '@/routes/agent-sessions/shared'

const TEAM_ID = new ObjectId()
const USER_ID = new ObjectId().toHexString()
const MARKER = 'upstream-secret-marker'
const seal = (value: string) => ({
  v: 1 as const,
  alg: 'A256GCM' as const,
  keyId: 'default',
  iv: '',
  authTag: '',
  ciphertext: value,
})

let bindingId = new ObjectId()
let selected: string[] = []
let allowList = ['*']
let expiresAt = new Date(Date.now() + 3600_000)
// A reconnect that lands mid-refresh changes the stored expiry, so the
// guarded write-back matches nothing.
let writeMatches = 1
let tokenCalls = 0
let tokenReply: { status: number; body: unknown } = { status: 200, body: {} }

useModels({
  teamByosBindings: () => ({
    findOne: async () => ({
      _id: TEAM_ID,
      plaudAccounts: [
        {
          id: bindingId,
          label: 'Ada',
          plaudUserId: 'plaud-user-1',
          userName: 'Ada',
          userEmail: null,
          clientId: 'signed-client',
          encryptedAccessToken: seal('pat_stored'),
          encryptedRefreshToken: seal('prt_stored'),
          accessTokenExpiresAt: expiresAt,
          createdAt: new Date(),
          access: { memberAllowList: allowList, updatedAt: new Date(), updatedBy: USER_ID },
        },
      ],
    }),
    updateOne: async () => ({ matchedCount: writeMatches, modifiedCount: writeMatches }),
  }),
})

useByosSecrets({
  encryptPlaudSecret: (value: string) => seal(value),
  decryptPlaudSecret: (envelope: { ciphertext: string }) => envelope.ciphertext,
})

useAgentSessionsShared({
  getAgentCredentialAccess: async () => ({ plaudAccountIds: selected }),
})

const { plaudScoped } = await import('@/routes/agent-sessions/plaud')

const realFetch = globalThis.fetch

beforeEach(() => {
  bindingId = new ObjectId()
  selected = [bindingId.toHexString()]
  allowList = ['*']
  expiresAt = new Date(Date.now() + 3600_000)
  writeMatches = 1
  tokenCalls = 0
  tokenReply = { status: 200, body: { access_token: 'pat_fresh', expires_in: 3600 } }
  globalThis.fetch = (async () => {
    tokenCalls += 1

    return new Response(JSON.stringify(tokenReply.body), { status: tokenReply.status })
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function fetchCredentials() {
  const outer = new Hono<{ Variables: AgentVars }>()

  outer.onError(errorHandler)
  outer.use('*', async (c, next) => {
    c.set('teamId' as never, TEAM_ID.toHexString() as never)
    c.set('userId', USER_ID)
    c.set('agent', { userId: USER_ID, sessionId: 's-1' } as AgentVars['agent'])
    await next()
  })
  outer.route('/plaud-accounts/:bindingId', plaudScoped)

  return outer.request(`/plaud-accounts/${bindingId.toHexString()}/credentials`)
}

describe('GET plaud-accounts/:id/credentials (session)', () => {
  test('vends the stored token while it is fresh', async () => {
    const res = await fetchCredentials()

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store, private')
    expect(await res.json()).toMatchObject({
      accessToken: 'pat_stored',
      apiBaseUrl: 'https://platform.plaud.ai/developer/api',
      authType: 'oauth_bearer',
    })
    expect(tokenCalls).toBe(0)
  })

  test('refuses an account this conversation did not select', async () => {
    selected = []
    const res = await fetchCredentials()

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'plaud_account_agent_access_denied' },
    })
  })

  test('refuses a member outside the binding allow-list even when selected', async () => {
    allowList = [new ObjectId().toHexString()]
    const res = await fetchCredentials()

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'plaud_account_access_denied' } })
  })

  test('refreshes an expiring token and caches it', async () => {
    expiresAt = new Date(Date.now() + 10_000)

    expect(await (await fetchCredentials()).json()).toMatchObject({ accessToken: 'pat_fresh' })
    await fetchCredentials()
    expect(tokenCalls).toBe(1)
  })

  test('does not cache a refresh that lost the race to a reconnect', async () => {
    expiresAt = new Date(Date.now() + 10_000)
    writeMatches = 0

    await fetchCredentials()
    await fetchCredentials()
    expect(tokenCalls).toBe(2)
  })

  test('asks for a reconnect when Plaud rejects the refresh, without its body', async () => {
    expiresAt = new Date(Date.now() + 10_000)
    tokenReply = { status: 400, body: { error: 'invalid_grant', detail: MARKER } }
    const res = await fetchCredentials()
    const text = await res.text()

    expect(res.status).toBe(409)
    expect(text).toContain('plaud_reconnect_required')
    expect(text).not.toContain(MARKER)
  })
})
