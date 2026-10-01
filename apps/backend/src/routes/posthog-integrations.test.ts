import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { posthogMetadataPath } from '@/lib/byos/posthog-oauth'
import { POSTHOG_SCOPE_CEILING } from '@/lib/byos/posthog-scopes'
import { errorHandler } from '@/lib/errors'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'
import { useByosPosthog } from '@/lib/test/doubles/byos-posthog'
import { useByosPosthogOAuth } from '@/lib/test/doubles/byos-posthog-oauth'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import type { PosthogDiscovery } from '@/lib/byos/posthog'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { PosthogIntegrationBinding, PosthogPendingOAuth } from '@/models'

const TEAM_ID = new ObjectId()
const USER_ID = new ObjectId().toHexString()
const CLIENT = {
  clientId: `https://api-dev.example.com${posthogMetadataPath(['user:read', 'project:read'])}`,
  redirectUri: 'https://api-dev.example.com/posthog-app/callback',
}
const seal = (value: string) => ({
  v: 1 as const,
  alg: 'A256GCM' as const,
  keyId: 'default',
  iv: '',
  authTag: '',
  ciphertext: value,
})

type UpdateCall = { filter: Record<string, unknown>; update: Record<string, unknown> }

let updates: UpdateCall[] = []
let stored: PosthogIntegrationBinding[] = []
let pending: PosthogPendingOAuth[] = []
let oauthClient: typeof CLIENT | null = CLIENT
let exchanges: { code: string; codeVerifier: string }[] = []
let revoked: string[] = []
let sharingBindings = 0
let grantedScope = 'user:read project:read insight:read'
let discovery: PosthogDiscovery = {
  user: { uuid: 'u-1', email: 'jane@acme.com', name: 'Jane' },
  projects: [],
}

useModels({
  teamByosBindings: () => ({
    findOne: async () => ({ _id: TEAM_ID, posthogIntegrations: stored }),
    countDocuments: async () => sharingBindings,
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      updates.push({ filter, update })

      return { matchedCount: 1, modifiedCount: 1, upsertedId: null }
    },
  }),
  posthogPendingOAuth: () => ({
    insertOne: async (doc: PosthogPendingOAuth) => {
      pending.push(doc)

      return { insertedId: doc._id }
    },
    findOneAndDelete: async ({ _id }: { _id: string }) => {
      const found = pending.find((doc) => doc._id === _id) ?? null

      pending = pending.filter((doc) => doc._id !== _id)

      return found
    },
    deleteOne: async () => ({ deletedCount: 1 }),
  }),
})

useAuthMiddleware({
  requireTeamRole: () => async (_c: unknown, next: () => Promise<void>) => {
    await next()
  },
})

useByosSecrets({
  encryptPosthogSecret: (value: string) => seal(value),
  decryptPosthogSecret: (envelope: { ciphertext: string }) => envelope.ciphertext,
})

useByosPosthogOAuth({
  posthogOAuthClient: () => oauthClient,
  posthogPublicBase: () => (oauthClient ? 'https://api-dev.example.com' : null),
  revokePosthogToken: async (input: { token: string }) => {
    revoked.push(input.token)
  },
  exchangePosthogCode: async (input: { code: string; codeVerifier: string }) => {
    exchanges.push({ code: input.code, codeVerifier: input.codeVerifier })

    return {
      accessToken: 'pha_1',
      refreshToken: 'phr_1',
      expiresAt: new Date(Date.now() + 3600_000),
      scope: grantedScope,
      scopedTeams: [2],
      scopedOrganizations: [],
    }
  },
})

useByosPosthog({
  discoverPosthogAccount: async () => discovery,
})

const { posthogIntegrationsRoutes } = await import('@/routes/posthog-integrations')
const { posthogAppRoutes } = await import('@/routes/posthog-app')

function app() {
  const outer = new Hono<{ Variables: TeamAuthVariables }>()

  outer.onError(errorHandler)
  outer.route('/posthog-app', posthogAppRoutes)
  outer.use('/team/*', async (c, next) => {
    c.set('teamId', TEAM_ID.toHexString())
    c.set('userId', USER_ID)
    c.set('teamRole', 'ADMINISTRATOR')
    await next()
  })
  outer.route('/team', posthogIntegrationsRoutes)

  return outer
}

function post(path: string, body: Record<string, unknown>) {
  return app().request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deepLink(html: string): URL {
  const match = /location\.href = "([^"]+)"/.exec(html)

  return new URL(JSON.parse(`"${match![1]!}"`) as string)
}

function storedBinding(overrides: Partial<PosthogIntegrationBinding> = {}) {
  return {
    id: new ObjectId(),
    label: 'Product',
    region: 'us' as const,
    apiBaseUrl: 'https://us.posthog.com',
    clientId: CLIENT.clientId,
    userEmail: 'jane@acme.com',
    userUuid: 'u-1',
    projects: [{ id: 1, name: 'Web', organizationId: 'org', organizationName: 'Acme' }],
    scopedTeams: [],
    requestedScopes: ['user:read', 'project:read', 'insight:read'],
    scope: 'user:read project:read insight:read',
    encryptedAccessToken: seal('pha_old'),
    encryptedRefreshToken: seal('phr_old'),
    accessTokenExpiresAt: null,
    reconnectRequired: true,
    createdAt: new Date('2026-01-01'),
    access: { memberAllowList: ['*'], updatedAt: new Date(), updatedBy: USER_ID },
    ...overrides,
  }
}

beforeEach(() => {
  updates = []
  stored = []
  pending = []
  exchanges = []
  revoked = []
  sharingBindings = 0
  grantedScope = 'user:read project:read insight:read'
  oauthClient = CLIENT
  discovery = {
    user: { uuid: 'u-1', email: 'jane@acme.com', name: 'Jane' },
    projects: [
      { id: 2, name: 'App', organizationId: 'org', organizationName: 'Acme' },
      { id: 3, name: 'Docs', organizationId: 'org', organizationName: 'Acme' },
    ],
  }
})

describe('POST /start-oauth', () => {
  test('stores a pending grant with an encrypted PKCE verifier and returns the region authorize URL', async () => {
    const res = await post('/team/start-oauth', { label: 'Product', region: 'eu' })
    const body = (await res.json()) as { authorizeUrl: string; state: string }
    const url = new URL(body.authorizeUrl)

    expect(res.status).toBe(200)
    expect(url.origin).toBe('https://eu.posthog.com')
    expect(url.searchParams.get('client_id')).toBe(CLIENT.clientId)
    expect(url.searchParams.get('state')).toBe(body.state)
    expect(pending[0]).toMatchObject({
      _id: body.state,
      region: 'eu',
      label: 'Product',
      clientId: CLIENT.clientId,
    })
    expect(pending[0]?.encryptedCodeVerifier.ciphertext).toHaveLength(64)
  })

  test('requests the scopes built from the permission matrix, defaulting to read only', async () => {
    const custom = await post('/team/start-oauth', {
      label: 'Product',
      region: 'us',
      permissions: { insight: 'read', feature_flag: 'write' },
    })
    const scope = new URL(
      ((await custom.json()) as { authorizeUrl: string }).authorizeUrl,
    ).searchParams.get('scope')

    expect(scope).toBe('user:read project:read insight:read feature_flag:read feature_flag:write')
    expect(pending[0]?.requestedScopes).toEqual(scope!.split(' '))

    await post('/team/start-oauth', { label: 'Product', region: 'us' })
    expect(pending[1]?.requestedScopes.some((entry) => entry.endsWith(':write'))).toBe(false)
  })

  test('rejects a matrix with an unknown resource or write on a read-only one', async () => {
    for (const permissions of [{ billing: 'read' }, { query: 'write' }]) {
      const res = await post('/team/start-oauth', { label: 'Product', region: 'us', permissions })

      expect(await res.json()).toMatchObject({ error: { code: 'invalid_posthog_permissions' } })
    }
    expect(pending).toHaveLength(0)
  })

  test('editing permissions keeps the binding region and defaults to its granted scopes', async () => {
    const existing = storedBinding({ region: 'eu', apiBaseUrl: 'https://eu.posthog.com' })

    stored = [existing]
    const res = await post('/team/start-oauth', { integrationId: existing.id.toHexString() })
    const url = new URL(((await res.json()) as { authorizeUrl: string }).authorizeUrl)

    expect(url.origin).toBe('https://eu.posthog.com')
    expect(url.searchParams.get('scope')).toBe('user:read project:read insight:read')
    expect(pending[0]).toMatchObject({ region: 'eu', label: 'Product', integrationId: existing.id })
  })

  test('refuses without a public HTTPS backend', async () => {
    oauthClient = null

    const res = await post('/team/start-oauth', { label: 'Product', region: 'us' })

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: { code: 'posthog_oauth_unavailable' } })
  })

  test('drops self-hosted', async () => {
    const res = await post('/team/start-oauth', { label: 'Product', region: 'self_hosted' })

    expect(res.status).toBe(400)
  })
})

describe('GET /posthog-app', () => {
  test('serves a per-permission-set document that requires exactly that set', async () => {
    const scopes = ['user:read', 'project:read', 'dashboard:read', 'dashboard:write']
    const path = posthogMetadataPath(scopes)

    expect(path).toMatch(/^\/posthog-app\/client-metadata\/s\/[0-9a-f]+\.json$/)
    const res = await app().request(path)

    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    expect(await res.json()).toMatchObject({
      client_id: `https://api-dev.example.com${path}`,
      redirect_uris: [CLIENT.redirectUri],
      token_endpoint_auth_method: 'none',
      'com.posthog': { scopes },
    })
    expect((await app().request('/posthog-app/client-metadata/s/03.json')).status).toBe(404)
  })

  test('keeps serving earlier client_id URLs so their grants still refresh', async () => {
    for (const path of [
      '/posthog-app/client-metadata.json',
      '/posthog-app/client-metadata/0123456789ab.json',
    ]) {
      const body = (await (await app().request(path)).json()) as {
        client_id: string
        'com.posthog': { scopes: string[] }
      }

      expect(body.client_id).toBe(`https://api-dev.example.com${path}`)
      expect(body['com.posthog'].scopes).toEqual(POSTHOG_SCOPE_CEILING)
    }
    expect((await app().request('/posthog-app/client-metadata/../x.json')).status).toBe(404)
  })

  test('callback exchanges the code with the stored verifier and binds the granted projects', async () => {
    await post('/team/start-oauth', { label: 'Product', region: 'us' })
    const state = pending[0]!._id
    const verifier = pending[0]!.encryptedCodeVerifier.ciphertext

    const res = await app().request(`/posthog-app/callback?state=${state}&code=c1`)
    const link = deepLink(await res.text())

    expect(link.protocol).toBe('nuphos:')
    expect(link.searchParams.get('binding_id')).toMatch(/^[a-f0-9]{24}$/)
    expect(exchanges).toEqual([{ code: 'c1', codeVerifier: verifier }])
    const pushed = (updates[0]?.update.$push as { posthogIntegrations: PosthogIntegrationBinding })
      .posthogIntegrations

    expect(pushed).toMatchObject({
      region: 'us',
      apiBaseUrl: 'https://us.posthog.com',
      clientId: CLIENT.clientId,
      scopedTeams: [2],
      encryptedAccessToken: seal('pha_1'),
      encryptedRefreshToken: seal('phr_1'),
      access: { memberAllowList: ['*'] },
    })
    expect(pushed.projects.map((project) => project.id)).toEqual([2, 3])
    expect(pending).toHaveLength(0)
  })

  test('a reconnect replaces the tokens, clears the reconnect flag and keeps reachable projects', async () => {
    const existing = storedBinding({
      projects: [
        { id: 3, name: 'Docs', organizationId: 'org', organizationName: 'Acme' },
        { id: 9, name: 'Gone', organizationId: 'org', organizationName: 'Acme' },
      ],
    })

    stored = [existing]
    await post('/team/start-oauth', {
      label: 'ignored',
      region: 'us',
      integrationId: existing.id.toHexString(),
    })
    const res = await app().request(`/posthog-app/callback?state=${pending[0]!._id}&code=c2`)

    expect(deepLink(await res.text()).searchParams.get('binding_id')).toBe(
      existing.id.toHexString(),
    )
    const replaced = (updates[0]?.update.$set as Record<string, PosthogIntegrationBinding>)[
      'posthogIntegrations.$[el]'
    ]!

    expect(replaced.reconnectRequired).toBeUndefined()
    expect(replaced.label).toBe('Product')
    expect(replaced.projects.map((project) => project.id)).toEqual([3])
    expect(replaced.encryptedAccessToken).toEqual(seal('pha_1'))
  })

  test('re-authorizing replaces the grant atomically and revokes the old tokens', async () => {
    const existing = storedBinding({ reconnectRequired: false })

    stored = [existing]
    grantedScope = 'user:read project:read insight:read insight:write'
    oauthClient = { ...CLIENT, clientId: `${CLIENT.clientId}-write` }
    await post('/team/start-oauth', {
      integrationId: existing.id.toHexString(),
      permissions: { insight: 'write', feature_flag: 'write' },
    })
    await app().request(`/posthog-app/callback?state=${pending[0]!._id}&code=c3`)

    expect(updates).toHaveLength(1)
    const replaced = (updates[0]?.update.$set as Record<string, PosthogIntegrationBinding>)[
      'posthogIntegrations.$[el]'
    ]!

    expect(replaced.requestedScopes).toContain('feature_flag:write')
    expect(replaced.scope).toBe(grantedScope)
    expect(replaced.encryptedRefreshToken).toEqual(seal('phr_1'))
    expect(revoked.toSorted((a, b) => a.localeCompare(b))).toEqual(['pha_old', 'phr_old'])

    stored = [replaced]
    const view = (await (
      await app().request(`/team/${existing.id.toHexString()}`)
    ).json()) as Record<string, unknown>

    expect(view).toMatchObject({
      permissions: { insight: 'write', feature_flag: 'none' },
      missingScopes: ['feature_flag:read', 'feature_flag:write'],
      extraScopes: [],
    })
  })

  test.each([
    ['the new grant shares the client', 0, false],
    ['another binding holds a grant on the old client', 1, true],
  ])(
    'revokes only the old access token when %s, since a refresh revocation sweeps the whole client',
    async (_case, sharing, newClient) => {
      const existing = storedBinding({ reconnectRequired: false })

      stored = [existing]
      sharingBindings = sharing
      if (newClient) oauthClient = { ...CLIENT, clientId: `${CLIENT.clientId}-other` }
      await post('/team/start-oauth', { integrationId: existing.id.toHexString() })
      await app().request(`/posthog-app/callback?state=${pending[0]!._id}&code=c4`)

      expect(updates).toHaveLength(1)
      expect(revoked).toEqual(['pha_old'])
    },
  )

  test('a cancelled or failed re-authorization leaves the old grant untouched', async () => {
    const existing = storedBinding({ reconnectRequired: false })

    stored = [existing]
    await post('/team/start-oauth', { integrationId: existing.id.toHexString() })
    const res = await app().request(
      `/posthog-app/callback?state=${pending[0]!._id}&error=access_denied`,
    )

    expect(deepLink(await res.text()).searchParams.get('error')).toBe('access_denied')
    await post('/team/start-oauth', { integrationId: existing.id.toHexString() })
    await app().request(`/team/start-oauth/${pending[0]!._id}`, { method: 'DELETE' })

    expect(updates).toHaveLength(0)
    expect(revoked).toHaveLength(0)
    expect(exchanges).toHaveLength(0)
  })

  test('a fresh connect by the same PostHog user reuses the binding even without a uuid', async () => {
    const existing = storedBinding({ reconnectRequired: false, userUuid: null })

    stored = [existing]
    discovery = { ...discovery, user: { uuid: null, email: 'jane@acme.com', name: 'Jane' } }
    await post('/team/start-oauth', { label: 'Again', region: 'us' })
    const res = await app().request(`/posthog-app/callback?state=${pending[0]!._id}&code=c5`)

    expect(deepLink(await res.text()).searchParams.get('binding_id')).toBe(
      existing.id.toHexString(),
    )
    expect(updates[0]?.update.$push).toBeUndefined()
  })

  test('relays a denied consent back to the desktop', async () => {
    await post('/team/start-oauth', { label: 'Product', region: 'us' })
    const res = await app().request(
      `/posthog-app/callback?state=${pending[0]!._id}&error=access_denied&error_description=no`,
    )
    const link = deepLink(await res.text())

    expect(link.searchParams.get('error')).toBe('access_denied')
    expect(exchanges).toHaveLength(0)
    expect(pending).toHaveLength(0)
  })

  test('rejects an unknown state without exchanging', async () => {
    const res = await app().request('/posthog-app/callback?state=deadbeef&code=c1')

    expect(deepLink(await res.text()).searchParams.get('error')).toBe('unknown_state')
    expect(exchanges).toHaveLength(0)
  })
})

describe('GET / with bindings from earlier schemas', () => {
  test('lists a pasted-key binding and a pre-matrix OAuth binding instead of failing', async () => {
    const pastedKey = {
      id: new ObjectId(),
      label: 'Old key',
      region: 'us',
      apiBaseUrl: 'https://us.posthog.com',
      userEmail: 'jane@acme.com',
      userUuid: 'u-1',
      projects: [{ id: 1, name: 'Web', organizationId: 'org', organizationName: 'Acme' }],
      encryptedApiKey: seal('phx_old'),
      createdAt: new Date(),
    }
    const preMatrix = storedBinding({ reconnectRequired: false, requestedScopes: undefined })

    stored = [pastedKey as unknown as PosthogIntegrationBinding, preMatrix]
    const res = await app().request('/team')
    const body = (await res.json()) as { integrations: Record<string, unknown>[] }

    expect(res.status).toBe(200)
    expect(body.integrations[0]).toMatchObject({
      status: 'reconnect_required',
      grantedScopes: [],
      requestedScopes: [],
      missingScopes: [],
    })
    expect(body.integrations[1]).toMatchObject({
      status: 'connected',
      requestedScopes: ['user:read', 'project:read', 'insight:read'],
      missingScopes: [],
      extraScopes: [],
    })
  })

  test('a pasted-key binding asks for a reconnect instead of vending', async () => {
    stored = [
      {
        ...storedBinding({ reconnectRequired: false }),
        encryptedAccessToken: undefined,
        scope: undefined,
      },
    ]
    const res = await app().request(`/team/${stored[0]!.id.toHexString()}/available-projects`)

    expect(await res.json()).toMatchObject({ error: { code: 'posthog_reconnect_required' } })
  })
})

describe('PUT /:integrationId/projects', () => {
  test('re-lists with the grant and stores only reachable projects', async () => {
    const existing = storedBinding({
      reconnectRequired: false,
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    })

    stored = [existing]
    const ok = await app().request(`/team/${existing.id.toHexString()}/projects`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectIds: [3, 2, 3] }),
    })

    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { projects: { id: number }[] }).projects.map((p) => p.id)).toEqual(
      [3, 2],
    )

    const missing = await app().request(`/team/${existing.id.toHexString()}/projects`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectIds: [99] }),
    })

    expect(await missing.json()).toMatchObject({ error: { code: 'posthog_projects_unavailable' } })
  })

  test('answers 409 posthog_reconnect_required for a binding marked for reconnect', async () => {
    const existing = storedBinding()

    stored = [existing]
    const res = await app().request(`/team/${existing.id.toHexString()}/available-projects`)

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'posthog_reconnect_required' } })
  })
})
