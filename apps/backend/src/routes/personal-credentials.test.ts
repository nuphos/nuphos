import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { mintPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { AppError } from '@/lib/errors'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useModels } from '@/lib/test/doubles/models'

import { personalCredentialRoutes, personalCredentialTokenRoutes } from './personal-credentials'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { AuthVariables } from '@/middleware/auth'
import type { Context, Next } from 'hono'

type Doc = Record<string, unknown>

const pending: Doc[] = []
const saved: Doc[] = []

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$exists' in value) return (doc[key] !== undefined) === value.$exists
      if ('$gt' in value) return (doc[key] as Date) > (value.$gt as Date)
      if ('$in' in value) return (value.$in as unknown[]).includes(doc[key])
    }

    return doc[key] === value
  })
}

function collection(rows: Doc[]) {
  return {
    insertOne: (doc: Doc) => {
      rows.push(doc)

      return Promise.resolve({ acknowledged: true })
    },
    findOne: (filter: Doc) => Promise.resolve(rows.find((doc) => matches(doc, filter)) ?? null),
    countDocuments: (filter: Doc) =>
      Promise.resolve(rows.filter((doc) => matches(doc, filter)).length),
    findOneAndDelete: (filter: Doc) => {
      const index = rows.findIndex((doc) => matches(doc, filter))

      return Promise.resolve(index < 0 ? null : rows.splice(index, 1)[0])
    },
    findOneAndUpdate: (filter: Doc, update: { $set: Doc; $setOnInsert: Doc }) => {
      const doc = rows.find((row) => matches(row, filter))

      if (doc) Object.assign(doc, update.$set)
      else rows.push({ ...filter, ...update.$setOnInsert, ...update.$set })

      return Promise.resolve(doc ?? null)
    },
  }
}

const fakeSeal = (plaintext: string) => ({ plaintext }) as unknown as EncryptedSecret

// TEAM has its own Google OAuth client unless a test clears it; everyone but
// 'outsider' is a member.
const TEAM = new ObjectId().toHexString()
const TEAM_B = new ObjectId().toHexString()
const TEAM_B_CLIENT = {
  clientId: 'b.apps.googleusercontent.com',
  encryptedClientSecret: fakeSeal('b-secret'),
}
let teamClient: { clientId: string; encryptedClientSecret: EncryptedSecret } | null = null

useModels({
  personalCredentialPendingOAuth: () => collection(pending) as never,
  personalCredentials: () => collection(saved) as never,
  teamByosBindings: () =>
    ({
      findOne: (filter: { _id: ObjectId }) => {
        const client = { [TEAM]: teamClient, [TEAM_B]: TEAM_B_CLIENT }[filter._id.toHexString()]

        return Promise.resolve(client ? { googleOAuthClient: client } : null)
      },
    }) as never,
})
useIdentity({
  getTeamMembership: ((userId: string, teamId: string) =>
    Promise.resolve(
      (teamId === TEAM || teamId === TEAM_B) && userId !== 'outsider'
        ? { role: 'MEMBER', team: { id: teamId, name: teamId === TEAM ? 'Acme' : 'Beta' } }
        : null,
    )) as never,
})
const fakeOpen = (envelope: EncryptedSecret) =>
  (envelope as unknown as { plaintext: string }).plaintext

useByosSecrets({
  encryptGithubSecret: fakeSeal,
  decryptGithubSecret: fakeOpen,
  encryptLinearSecret: fakeSeal,
  decryptLinearSecret: fakeOpen,
})
// The signed-in member is whoever the test names in x-test-user.
useAuthMiddleware({
  requireAuth: async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    c.set('userId', c.req.header('x-test-user') ?? '')
    await next()
  },
})

const saveConfig = {
  github: { ...config.byos.github },
  linear: { ...config.byos.linear },
  publicBackendUrl: config.agent.publicBackendUrl,
}

// As in production: GitHub's install redirect is a desktop deep link, so the
// callback has to come from the backend's public URL, not the setup redirect.
Object.assign(config.agent, { publicBackendUrl: 'https://api.nuphos.test/' })

Object.assign(config.byos.github, {
  clientId: 'Iv1.client',
  clientSecret: 'gh-secret',
  setupRedirect: 'nuphos://github-callback',
  encryptionKey: 'k',
})
Object.assign(config.byos.linear, {
  clientId: 'lin-client',
  clientSecret: 'lin-secret',
  setupRedirect: 'https://elsewhere.test/linear-app/setup',
  encryptionKey: 'k',
})
afterAll(() => {
  Object.assign(config.byos.github, saveConfig.github)
  Object.assign(config.byos.linear, saveConfig.linear)
  Object.assign(config.agent, { publicBackendUrl: saveConfig.publicBackendUrl })
})

// Each provider's token exchange and identity lookup, answered for the approver.
const fetchSpy = spyOn(globalThis, 'fetch')
const revoked: string[] = []
let googleTokenRequest: URLSearchParams | null = null

afterAll(() => fetchSpy.mockRestore())
fetchSpy.mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)

  if (url.includes('github.com/login/oauth/access_token'))
    return Promise.resolve(
      Response.json({ access_token: 'ghu_v', refresh_token: 'ghr_v', expires_in: 28_800 }),
    )
  if (url.endsWith('/user')) return Promise.resolve(Response.json({ id: 9, login: 'victim' }))
  if (url.includes('linear.app/oauth/token'))
    return Promise.resolve(Response.json({ access_token: 'lin_v', expires_in: 3600 }))
  if (url.includes('linear.app/graphql'))
    return Promise.resolve(
      Response.json({
        data: {
          viewer: { id: 'u9', name: 'victim' },
          organization: { id: 'org-1', name: 'Acme', urlKey: 'acme' },
        },
      }),
    )

  if (url.includes('oauth2.googleapis.com/token')) {
    googleTokenRequest = new URLSearchParams((init?.body as string | undefined) ?? '')

    return Promise.resolve(
      Response.json({ access_token: 'ya29_v', refresh_token: 'g_refresh', expires_in: 3599 }),
    )
  }
  if (url.includes('googleapis.com/oauth2/v2/userinfo'))
    return Promise.resolve(Response.json({ id: 'g9', email: 'victim' }))
  if (url.includes('oauth2.googleapis.com/revoke')) {
    revoked.push(url)

    return Promise.resolve(new Response(null, { status: 200 }))
  }

  return Promise.reject(new Error(`unexpected fetch ${url}`))
}) as typeof fetch)

const app = new Hono<{ Variables: AuthVariables }>()

app.onError((error, c) =>
  error instanceof AppError
    ? c.json({ code: error.code }, error.status as 400)
    : c.json({ code: 'internal' }, 500),
)
app.route('/personal-credentials', personalCredentialRoutes)

function requestStart(provider: string, userId: string, teamId: string | null = TEAM) {
  return app.request(`/personal-credentials/${provider}/start`, {
    method: 'POST',
    headers: { 'x-test-user': userId, 'content-type': 'application/json' },
    body: JSON.stringify(teamId ? { teamId } : {}),
  })
}

async function start(provider: string, userId: string, teamId = TEAM): Promise<string> {
  const res = await requestStart(provider, userId, teamId)

  expect(res.status).toBe(200)
  const { state, authorizeUrl } = (await res.json()) as { state: string; authorizeUrl: string }

  expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(
    `https://api.nuphos.test/personal-credentials/${provider}/callback`,
  )

  return state
}

/** Follows the provider redirect and returns the deep link the callback page opens. */
async function callback(provider: string, state: string): Promise<URL> {
  const res = await app.request(
    `/personal-credentials/${provider}/callback?state=${state}&code=provider-code`,
  )
  const html = await res.text()
  const href = /location\.href = "([^"]+)"/u.exec(html)?.[1] ?? ''

  return new URL(JSON.parse(`"${href}"`) as string)
}

function complete(provider: string, userId: string, state: string, code: string) {
  return app.request(`/personal-credentials/${provider}/complete`, {
    method: 'POST',
    headers: { 'x-test-user': userId, 'content-type': 'application/json' },
    body: JSON.stringify({ state, code }),
  })
}

beforeEach(() => {
  pending.length = 0
  saved.length = 0
  revoked.length = 0
  googleTokenRequest = null
  teamClient = {
    clientId: 'team.apps.googleusercontent.com',
    encryptedClientSecret: fakeSeal('team-secret'),
  }
})

describe.each(['github', 'linear', 'gmail', 'google-drive'])(
  '%s Personal Credential OAuth',
  (provider) => {
    test('the starter claims the staged grant with the callback code', async () => {
      const state = await start(provider, 'alice')
      const link = await callback(provider, state)

      expect(link.protocol).toBe('nuphos:')
      expect(saved).toHaveLength(0)
      const res = await complete(provider, 'alice', state, link.searchParams.get('code') ?? '')

      expect(res.status).toBe(200)
      expect(saved).toMatchObject([{ userId: 'alice', provider, login: 'victim' }])
    })

    test('another member cannot claim a grant someone else started', async () => {
      const state = await start(provider, 'attacker')
      const link = await callback(provider, state)
      const code = link.searchParams.get('code') ?? ''

      // The victim's app holds the code but did not start the flow.
      expect((await complete(provider, 'victim', state, code)).status).toBe(404)
      // The starter never receives the code, and guessing it fails.
      expect((await complete(provider, 'attacker', state, 'guessed')).status).toBe(404)
      expect(saved).toHaveLength(0)
    })

    test('a claim and a callback are single-use', async () => {
      const state = await start(provider, 'alice')
      const link = await callback(provider, state)
      const code = link.searchParams.get('code') ?? ''

      expect((await callback(provider, state)).searchParams.get('error')).toBe('invalid_state')
      expect((await complete(provider, 'alice', state, code)).status).toBe(200)
      expect((await complete(provider, 'alice', state, code)).status).toBe(404)
    })

    test('an expired request or staged grant is refused', async () => {
      const state = await start(provider, 'alice')

      pending[0]!.expiresAt = new Date(Date.now() - 1000)
      expect((await callback(provider, state)).searchParams.get('error')).toBe('invalid_state')

      const fresh = await start(provider, 'alice')
      const code = (await callback(provider, fresh)).searchParams.get('code') ?? ''

      pending.find((doc) => doc._id === fresh)!.expiresAt = new Date(Date.now() - 1000)
      expect((await complete(provider, 'alice', fresh, code)).status).toBe(404)
      expect(saved).toHaveLength(0)
    })
  },
)

describe('Google Personal Credentials', () => {
  test('each provider asks Google for its own scope with offline access', async () => {
    for (const [provider, scope] of [
      ['gmail', 'https://www.googleapis.com/auth/gmail.modify'],
      ['google-drive', 'https://www.googleapis.com/auth/drive'],
    ] as const) {
      const res = await requestStart(provider, 'alice')
      const url = new URL(((await res.json()) as { authorizeUrl: string }).authorizeUrl)

      expect(url.searchParams.get('client_id')).toBe('team.apps.googleusercontent.com')
      expect(url.searchParams.get('scope')).toBe(`openid email ${scope}`)
      expect(url.searchParams.get('access_type')).toBe('offline')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    }
  })

  test('the code is exchanged with the team’s client and the grant records the team', async () => {
    const state = await start('gmail', 'alice')
    const link = await callback('gmail', state)

    expect(googleTokenRequest?.get('client_id')).toBe('team.apps.googleusercontent.com')
    expect(googleTokenRequest?.get('client_secret')).toBe('team-secret')
    expect(
      (await complete('gmail', 'alice', state, link.searchParams.get('code') ?? '')).status,
    ).toBe(200)
    expect(saved).toMatchObject([
      { userId: 'alice', provider: 'gmail', teamId: TEAM, workspaceName: 'Acme' },
    ])
  })

  test('connecting needs a team the member belongs to, with a client', async () => {
    const code = async (res: Response) => ((await res.json()) as { code: string }).code

    expect((await requestStart('gmail', 'alice', null)).status).toBe(403)
    expect((await requestStart('gmail', 'outsider')).status).toBe(403)
    teamClient = null
    const res = await requestStart('google-drive', 'alice')

    expect(res.status).toBe(409)
    expect(await code(res)).toBe('google_oauth_client_not_configured')
    expect(pending).toHaveLength(0)
  })

  test('a member of two teams keeps a grant per team, each from that team’s client', async () => {
    for (const [teamId, clientId] of [
      [TEAM, 'team.apps.googleusercontent.com'],
      [TEAM_B, 'b.apps.googleusercontent.com'],
    ]) {
      const state = await start('gmail', 'alice', teamId)
      const link = await callback('gmail', state)

      expect(googleTokenRequest?.get('client_id')).toBe(clientId)
      expect(
        (await complete('gmail', 'alice', state, link.searchParams.get('code') ?? '')).status,
      ).toBe(200)
    }
    expect(saved).toMatchObject([
      { provider: 'gmail', teamId: TEAM, workspaceName: 'Acme' },
      { provider: 'gmail', teamId: TEAM_B, workspaceName: 'Beta' },
    ])
    expect(revoked).toHaveLength(0)
    expect((await disconnect('gmail', TEAM)).status).toBe(204)
    expect(saved).toMatchObject([{ teamId: TEAM_B }])
    expect(revoked).toHaveLength(1)
  })

  test('disconnecting revokes at Google only once no Google grant remains', async () => {
    saved.push(googleGrant('alice', 'gmail', 'mail'), googleGrant('alice', 'google-drive', 'drive'))
    expect((await disconnect('gmail')).status).toBe(204)
    expect(revoked).toHaveLength(0)
    expect((await disconnect('google-drive')).status).toBe(204)
    expect(revoked).toHaveLength(1)
  })
})

const disconnect = (provider: string, teamId = TEAM) =>
  app.request(`/personal-credentials/${provider}?teamId=${teamId}`, {
    method: 'DELETE',
    headers: { 'x-test-user': 'alice' },
  })

function googleGrant(userId: string, provider: string, token: string): Doc {
  return {
    userId,
    provider,
    login: `${userId}@example.com`,
    teamId: TEAM,
    encryptedAccessToken: fakeSeal(token),
    encryptedRefreshToken: fakeSeal(`${token}-refresh`),
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/** A turn in conv-1, owned by `owner`. */
const turn = (actor: string, humanTurn: boolean, teamId = TEAM) =>
  mintPreviewMcpToken({
    userId: actor,
    conversationOwnerUserId: 'owner',
    sessionId: 'conv-1',
    teamId,
    humanTurn,
  })

describe('Google token handout', () => {
  const handout = new Hono()

  handout.onError((error, c) =>
    error instanceof AppError
      ? c.json({ code: error.code }, error.status as 400)
      : c.json({ code: 'internal' }, 500),
  )
  handout.route('/personal-credentials', personalCredentialTokenRoutes)

  const fetchToken = (provider: string, token?: string) =>
    handout.request(`/personal-credentials/${provider}/token`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })

  beforeEach(() => {
    saved.push(
      googleGrant('owner', 'gmail', 'owner-mail'),
      googleGrant('teammate', 'gmail', 'teammate-mail'),
    )
  })

  test('the owner’s own and automated turns get the owner’s token', async () => {
    for (const humanTurn of [true, false]) {
      const res = await fetchToken('gmail', turn('owner', humanTurn))

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ token: 'owner-mail', login: 'owner@example.com' })
    }
    // An agent's turn on the owner's behalf, e.g. a thread message.
    expect(await (await fetchToken('gmail', turn('teammate', false))).json()).toMatchObject({
      token: 'owner-mail',
    })
  })

  test('each team’s conversations get that team’s grant', async () => {
    saved.push({ ...googleGrant('owner', 'gmail', 'owner-mail-b'), teamId: TEAM_B })
    const res = await fetchToken('gmail', turn('owner', true, TEAM_B))

    expect(await res.json()).toMatchObject({ token: 'owner-mail-b' })
  })

  test('a teammate’s message in someone else’s session gets no token', async () => {
    const res = await fetchToken('gmail', turn('teammate', true))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ code: 'personal_credential_owner_only' })
  })

  test('409 when the team has no Google OAuth client', async () => {
    teamClient = null
    const res = await fetchToken('gmail', turn('owner', true))

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'google_oauth_client_not_configured' })
  })

  test('404 when the member has not connected the provider', async () => {
    const res = await fetchToken('google-drive', turn('owner', true))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ code: 'personal_credential_not_connected' })
  })

  test('only conversation tokens, and only Google providers', async () => {
    expect((await fetchToken('gmail')).status).toBe(403)
    expect((await fetchToken('github', turn('owner', true))).status).toBe(404)
  })
})
