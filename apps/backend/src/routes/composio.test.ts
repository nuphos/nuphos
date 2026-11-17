import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import * as composioClient from '@/lib/composio'
import { mintPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { AppError } from '@/lib/errors'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useModels } from '@/lib/test/doubles/models'
import { useTokenRevocation } from '@/lib/test/doubles/token-revocation'

import {
  composioRoutes,
  personalCredentialRoutes,
  personalCredentialTokenRoutes,
} from './personal-credentials'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { AuthVariables } from '@/middleware/auth'
import type { Context, Next } from 'hono'

// Gmail and Google Drive through Nuphos's Composio project, for teams without
// their own Google OAuth client. Composio's API is mocked: no key is used.
useTokenRevocation({ isTokenRevoked: async () => false, inheritRevocation: async () => false })

type Doc = Record<string, unknown>

const pending: Doc[] = []
const saved: Doc[] = []

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$exists' in value) return (doc[key] !== undefined) === value.$exists
      if ('$gt' in value) return (doc[key] as Date) > (value.$gt as Date)
    }

    return doc[key] === value
  })
}

function collection(rows: Doc[]) {
  return {
    insertOne: (doc: Doc) => Promise.resolve(rows.push(doc)),
    findOne: (filter: Doc) => Promise.resolve(rows.find((doc) => matches(doc, filter)) ?? null),
    countDocuments: (filter: Doc) =>
      Promise.resolve(rows.filter((doc) => matches(doc, filter)).length),
    findOneAndDelete: (filter: Doc) => {
      const index = rows.findIndex((doc) => matches(doc, filter))

      return Promise.resolve(index < 0 ? null : rows.splice(index, 1)[0])
    },
    findOneAndUpdate: (filter: Doc, update: { $set: Doc; $unset: Doc; $setOnInsert: Doc }) => {
      const doc = rows.find((row) => matches(row, filter))
      const before = doc ? { ...doc } : null

      if (doc) Object.assign(doc, update.$set)
      else rows.push({ ...filter, ...update.$setOnInsert, ...update.$set })
      const row = doc ?? rows.at(-1)!

      for (const key of Object.keys(update.$unset)) delete row[key]

      return Promise.resolve(before)
    },
  }
}

const TEAM = new ObjectId().toHexString()
const OTHER_TEAM = new ObjectId().toHexString()
let teamClient: Doc | null = null

useModels({
  personalCredentialPendingOAuth: () => collection(pending),
  personalCredentials: () => collection(saved),
  teamByosBindings: () => ({
    findOne: () => Promise.resolve(teamClient ? { googleOAuthClient: teamClient } : null),
  }),
})
useIdentity({
  getTeamMembership: (userId: string, teamId: string) =>
    Promise.resolve(
      [TEAM, OTHER_TEAM].includes(teamId) && userId !== 'outsider'
        ? { role: 'MEMBER', team: { id: teamId, name: 'Acme' } }
        : null,
    ),
})
const fakeSeal = (plaintext: string) => ({ plaintext }) as unknown as EncryptedSecret

useByosSecrets({
  encryptLinearSecret: fakeSeal,
  decryptLinearSecret: (e: EncryptedSecret) => (e as unknown as { plaintext: string }).plaintext,
})
useAuthMiddleware({
  requireAuth: async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    c.set('userId', c.req.header('x-test-user') ?? '')
    await next()
  },
})

const saveConfig = {
  ...config.byos.composio,
  publicBackendUrl: config.agent.publicBackendUrl,
  linearKey: config.byos.linear.encryptionKey,
}
const COMPOSIO = { apiKey: 'composio-key' }
const noComposio = { apiKey: undefined }
const authConfigSpy = spyOn(composioClient, 'composioAuthConfigId').mockImplementation(
  async (toolkit) => `ac_${toolkit}`,
)

Object.assign(config.agent, { publicBackendUrl: 'https://api.nuphos.test/' })
// Seals a team-client grant's PKCE verifier.
Object.assign(config.byos.linear, { encryptionKey: 'k' })
afterAll(() => {
  authConfigSpy.mockRestore()
  const { publicBackendUrl, linearKey, ...composio } = saveConfig

  Object.assign(config.byos.composio, composio)
  Object.assign(config.byos.linear, { encryptionKey: linearKey })
  Object.assign(config.agent, { publicBackendUrl })
})

// Composio's API: every request is recorded; the account is ACTIVE unless a test says otherwise.
const requests: { method: string; path: string; key: string | null; body: Doc | null }[] = []
let accountStatus = 'ACTIVE'
const fetchSpy = spyOn(globalThis, 'fetch')

afterAll(() => fetchSpy.mockRestore())
fetchSpy.mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input))

  if (url.host !== 'backend.composio.dev') return Promise.reject(new Error(`unexpected ${url}`))
  const path = url.pathname.replace('/api/v3.1', '') + url.search
  const method = init?.method ?? 'GET'

  requests.push({
    method,
    path,
    key: new Headers(init?.headers).get('x-api-key'),
    body: init?.body ? (JSON.parse(init.body as string) as Doc) : null,
  })
  if (path === '/connected_accounts/link') {
    return Promise.resolve(
      Response.json(
        { redirect_url: 'https://connect.composio.dev/link/lk_1', connected_account_id: 'ca_new' },
        { status: 201 },
      ),
    )
  }
  if (method === 'GET') return Promise.resolve(Response.json({ status: accountStatus }))
  if (method === 'DELETE') return Promise.resolve(Response.json({ success: true }))
  if (path === '/tools/execute/GMAIL_GET_PROFILE') {
    return Promise.resolve(
      Response.json({ successful: true, data: { emailAddress: 'alice@gmail.test' }, error: null }),
    )
  }

  return Promise.resolve(Response.json({ successful: true, data: { ok: 1 }, error: null }))
}) as typeof fetch)

const app = new Hono<{ Variables: AuthVariables }>()

app.onError((error, c) =>
  error instanceof AppError
    ? c.json({ code: error.code }, error.status as 400)
    : c.json({ code: 'internal' }, 500),
)
app.route('/personal-credentials', personalCredentialRoutes)
app.route('/personal-credentials', personalCredentialTokenRoutes)
app.route('/composio', composioRoutes)

const as = (userId: string) => ({ 'x-test-user': userId, 'content-type': 'application/json' })

async function start(provider: string, userId = 'alice') {
  return app.request(`/personal-credentials/${provider}/start`, {
    method: 'POST',
    headers: as(userId),
    body: JSON.stringify({ teamId: TEAM }),
  })
}

/** Composio's return to the callback; gives the deep link the page opens. */
async function callback(provider: string, query: string): Promise<URL> {
  const html = await (
    await app.request(`/personal-credentials/${provider}/callback?${query}`)
  ).text()
  const href = /location\.href = "([^"]+)"/u.exec(html)?.[1] ?? ''

  return new URL(JSON.parse(`"${href}"`) as string)
}

const turn = (actor: string, humanTurn: boolean, teamId = TEAM) =>
  mintPreviewMcpToken({
    userId: actor,
    conversationOwnerUserId: 'owner',
    sessionId: 'conv-1',
    teamId,
    humanTurn,
  })

function execute(token: string, body: Doc) {
  return app.request('/composio/execute', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const connection = (userId: string, provider: string, id: string): Doc => ({
  _id: new ObjectId(),
  userId,
  provider,
  teamId: TEAM,
  providerUserId: id,
  login: `${userId}@gmail.test`,
  composioAccountId: id,
  encryptedRefreshToken: null,
  accessTokenExpiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
})

beforeEach(() => {
  Object.assign(config.byos.composio, COMPOSIO)
  teamClient = null
  accountStatus = 'ACTIVE'
  pending.length = 0
  saved.length = 0
  requests.length = 0
})

describe('connecting through Composio', () => {
  test('a team without its own client connects with one Connect Link, and nothing but the account id is kept', async () => {
    const res = await start('gmail')
    const { state, authorizeUrl } = (await res.json()) as { state: string; authorizeUrl: string }

    expect(authorizeUrl).toBe('https://connect.composio.dev/link/lk_1')
    expect(requests[0]).toEqual({
      method: 'POST',
      path: '/connected_accounts/link',
      key: 'composio-key',
      body: {
        auth_config_id: 'ac_gmail',
        user_id: `${TEAM}:alice`,
        callback_url: `https://api.nuphos.test/personal-credentials/gmail/callback?state=${state}`,
      },
    })

    // An account id in the callback URL is ignored: only the one the link created is checked.
    const link = await callback(
      'gmail',
      `state=${state}&status=success&connected_account_id=ca_someone_else`,
    )

    expect(requests.map((r) => `${r.method} ${r.path}`)).toContain('GET /connected_accounts/ca_new')
    expect(requests.some((r) => r.path.includes('ca_someone_else'))).toBe(false)
    const code = link.searchParams.get('code') ?? ''

    // Only the member who started it can claim it.
    const claim = (userId: string) =>
      app.request('/personal-credentials/gmail/complete', {
        method: 'POST',
        headers: as(userId),
        body: JSON.stringify({ state, code }),
      })

    expect((await claim('mallory')).status).toBe(404)
    expect(saved).toHaveLength(0)
    expect((await claim('alice')).status).toBe(200)
    expect(saved).toEqual([
      expect.objectContaining({
        userId: 'alice',
        provider: 'gmail',
        teamId: TEAM,
        login: 'alice@gmail.test',
        composioAccountId: 'ca_new',
      }),
    ])
    expect(saved[0]).not.toHaveProperty('encryptedAccessToken')
  })

  test('a declined or unfinished connection stages nothing', async () => {
    let { state } = (await (await start('gmail')).json()) as { state: string }

    expect(
      (await callback('gmail', `state=${state}&status=failed`)).searchParams.get('error'),
    ).toBe('access_denied')
    accountStatus = 'INITIATED'
    ;({ state } = (await (await start('gmail')).json()) as { state: string })
    const link = await callback('gmail', `state=${state}&status=success`)

    expect(link.searchParams.get('error')).toBe('composio_not_connected')
    expect(link.searchParams.get('code')).toBeNull()
  })

  test('reconnecting replaces the old Composio connection and deletes it', async () => {
    saved.push(connection('alice', 'gmail', 'ca_old'))
    const { state } = (await (await start('gmail')).json()) as { state: string }
    const code = (await callback('gmail', `state=${state}&status=success`)).searchParams.get('code')

    await app.request('/personal-credentials/gmail/complete', {
      method: 'POST',
      headers: as('alice'),
      body: JSON.stringify({ state, code }),
    })
    await Bun.sleep(0)

    expect(saved).toEqual([expect.objectContaining({ composioAccountId: 'ca_new' })])
    expect(requests.map((r) => `${r.method} ${r.path}`)).toContain(
      'DELETE /connected_accounts/ca_old',
    )
  })

  test('a team with its own Google client keeps using it', async () => {
    teamClient = {
      clientId: 'team.apps.googleusercontent.com',
      encryptedClientSecret: fakeSeal('s'),
    }
    const { authorizeUrl } = (await (await start('gmail')).json()) as { authorizeUrl: string }

    expect(new URL(authorizeUrl).host).toBe('accounts.google.com')
    expect(requests).toHaveLength(0)
  })

  test('without the server key (self-hosted) a team without a client is told to add one', async () => {
    Object.assign(config.byos.composio, noComposio)
    const res = await start('gmail')

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'google_oauth_client_not_configured' })
    expect(requests).toHaveLength(0)
  })

  test('disconnecting deletes the Composio connection, without a Google revoke', async () => {
    saved.push(connection('alice', 'gmail', 'ca_1'), connection('alice', 'google-drive', 'ca_2'))
    const res = await app.request(`/personal-credentials/gmail?teamId=${TEAM}`, {
      method: 'DELETE',
      headers: as('alice'),
    })

    expect(res.status).toBe(204)
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'DELETE /connected_accounts/ca_1',
    ])
    expect(saved).toEqual([expect.objectContaining({ provider: 'google-drive' })])
  })
})

describe('agents running tools through Composio', () => {
  beforeEach(() => {
    saved.push(connection('owner', 'gmail', 'ca_owner'))
  })

  test('the token handout points the agent at execute instead of handing out a token', async () => {
    const res = await app.request('/personal-credentials/gmail/token', {
      headers: { Authorization: `Bearer ${await turn('owner', true)}` },
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'personal_credential_via_composio' })
  })

  test('runs a Gmail tool as the session owner, with the server key', async () => {
    const res = await execute(await turn('owner', true), {
      tool: 'GMAIL_FETCH_EMAILS',
      arguments: { query: 'is:unread' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ successful: true, data: { ok: 1 }, error: null })
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/tools/execute/GMAIL_FETCH_EMAILS',
        key: 'composio-key',
        body: {
          connected_account_id: 'ca_owner',
          user_id: `${TEAM}:owner`,
          arguments: { query: 'is:unread' },
          version: 'latest',
        },
      },
    ])
  })

  test('refuses other toolkits and permanent mail deletion', async () => {
    const token = await turn('owner', true)

    for (const tool of ['SLACK_SEND_MESSAGE', 'GMAIL_DELETE_MESSAGE', 'gmail_send_email']) {
      const res = await execute(token, { tool })

      expect(res.status).toBe(400)
    }
    expect(requests).toHaveLength(0)
  })

  test('a teammate’s message, another team, or an unconnected toolkit gets nothing', async () => {
    const teammate = await execute(await turn('teammate', true), { tool: 'GMAIL_FETCH_EMAILS' })

    expect(teammate.status).toBe(403)
    expect(await teammate.json()).toEqual({ code: 'personal_credential_owner_only' })
    expect(
      (await execute(await turn('owner', true, OTHER_TEAM), { tool: 'GMAIL_FETCH_EMAILS' })).status,
    ).toBe(404)
    expect(
      (await execute(await turn('owner', true), { tool: 'GOOGLEDRIVE_FIND_FILE' })).status,
    ).toBe(404)
    // A signed-in session is not a conversation token.
    expect((await execute('not-a-token', { tool: 'GMAIL_FETCH_EMAILS' })).status).toBe(403)
    expect(requests).toHaveLength(0)
  })
})
