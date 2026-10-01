import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { PosthogApiError } from '@/lib/byos/posthog-request'
import { useByosPosthogOAuth } from '@/lib/test/doubles/byos-posthog-oauth'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import type { PosthogIntegrationBinding } from '@/models'

const TEAM_ID = new ObjectId()
const seal = (value: string) => ({
  v: 1 as const,
  alg: 'A256GCM' as const,
  keyId: 'default',
  iv: '',
  authTag: '',
  ciphertext: value,
})

let updates: { filter: Record<string, unknown>; update: Record<string, unknown> }[] = []
let refreshes: string[] = []
let refreshResult: () => Promise<unknown> = () => Promise.resolve(null)
let revoked: string[] = []
let matched = 1
let latest: PosthogIntegrationBinding | null = null

useModels({
  teamByosBindings: () => ({
    findOne: async () => (latest ? { posthogIntegrations: [latest] } : null),
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      updates.push({ filter, update })

      return { matchedCount: matched, modifiedCount: matched }
    },
  }),
})

useByosSecrets({
  encryptPosthogSecret: (value: string) => seal(value),
  decryptPosthogSecret: (envelope: { ciphertext: string }) => envelope.ciphertext,
})

useByosPosthogOAuth({
  refreshPosthogTokens: async (input: { refreshToken: string }) => {
    refreshes.push(input.refreshToken)

    return await refreshResult()
  },
  revokePosthogToken: async (input: { token: string }) => {
    revoked.push(input.token)
  },
})

const { getPosthogAccessToken, invalidatePosthogAccessToken, PosthogReconnectRequired } =
  await import('@/lib/byos/posthog-tokens')

function binding(overrides: Partial<PosthogIntegrationBinding> = {}): PosthogIntegrationBinding {
  return {
    id: new ObjectId(),
    label: 'Product',
    region: 'us',
    apiBaseUrl: 'https://us.posthog.com',
    clientId: 'https://api.example.com/posthog-app/client-metadata.json',
    userEmail: null,
    userUuid: 'u-1',
    projects: [],
    scopedTeams: [],
    requestedScopes: ['user:read'],
    scope: 'user:read',
    encryptedAccessToken: seal('pha_old'),
    encryptedRefreshToken: seal('phr_1'),
    accessTokenExpiresAt: new Date(Date.now() - 1000),
    createdAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  updates = []
  refreshes = []
  revoked = []
  matched = 1
  latest = null
  refreshResult = () =>
    Promise.resolve({
      accessToken: 'pha_new',
      refreshToken: 'phr_2',
      expiresAt: new Date(Date.now() + 3600_000),
      scope: 'user:read project:read',
      scopedTeams: [],
      scopedOrganizations: [],
    })
})

describe('getPosthogAccessToken', () => {
  test('serves a fresh stored token without refreshing', async () => {
    const fresh = binding({ accessTokenExpiresAt: new Date(Date.now() + 3600_000) })

    expect((await getPosthogAccessToken(TEAM_ID, fresh)).token).toBe('pha_old')
    expect(refreshes).toEqual([])
  })

  test('refreshes an expired token once for concurrent callers and persists the rotation', async () => {
    const expired = binding()
    const [a, b] = await Promise.all([
      getPosthogAccessToken(TEAM_ID, expired),
      getPosthogAccessToken(TEAM_ID, expired),
    ])

    expect([a.token, b.token]).toEqual(['pha_new', 'pha_new'])
    expect(refreshes).toEqual(['phr_1'])
    expect(updates).toHaveLength(1)
    expect(updates[0]?.filter).toMatchObject({
      posthogIntegrations: {
        $elemMatch: { id: expired.id, 'encryptedRefreshToken.ciphertext': 'phr_1' },
      },
    })
    expect(updates[0]?.update.$set).toMatchObject({
      'posthogIntegrations.$.encryptedAccessToken': seal('pha_new'),
      'posthogIntegrations.$.encryptedRefreshToken': seal('phr_2'),
    })
    invalidatePosthogAccessToken(TEAM_ID, expired.id)
  })

  test('keeps the stored refresh token when PostHog does not rotate it', async () => {
    const expired = binding()

    refreshResult = () =>
      Promise.resolve({
        accessToken: 'pha_new',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3600_000),
        scope: '',
        scopedTeams: [],
        scopedOrganizations: [],
      })
    await getPosthogAccessToken(TEAM_ID, expired)

    expect(updates[0]?.update.$set).toMatchObject({
      'posthogIntegrations.$.encryptedRefreshToken': seal('phr_1'),
      'posthogIntegrations.$.scope': 'user:read',
    })
    invalidatePosthogAccessToken(TEAM_ID, expired.id)
  })

  test('marks the binding for reconnect when PostHog rejects the refresh token', async () => {
    const expired = binding()

    refreshResult = () => Promise.reject(new PosthogApiError(400, 'invalid_grant', 'invalid_grant'))
    const error = await getPosthogAccessToken(TEAM_ID, expired).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(PosthogReconnectRequired)
    expect(updates[0]?.update.$set).toMatchObject({
      'posthogIntegrations.$.reconnectRequired': true,
    })
  })

  test('refuses a binding already marked for reconnect without calling PostHog', async () => {
    const error = await getPosthogAccessToken(TEAM_ID, binding({ reconnectRequired: true })).catch(
      (err: unknown) => err,
    )

    expect(error).toBeInstanceOf(PosthogReconnectRequired)
    expect(refreshes).toEqual([])
  })

  test('leaves the binding usable when PostHog is merely unreachable', async () => {
    const expired = binding()

    refreshResult = () => Promise.reject(new PosthogApiError(0, 'Could not reach PostHog'))
    const error = await getPosthogAccessToken(TEAM_ID, expired).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(PosthogApiError)
    expect(updates).toHaveLength(0)
  })

  test('discards and revokes a token minted from a grant replaced mid-refresh, serving the new grant', async () => {
    const stale = binding()

    matched = 0
    latest = binding({
      id: stale.id,
      encryptedAccessToken: seal('pha_reauthorized'),
      encryptedRefreshToken: seal('phr_reauthorized'),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    })
    const token = await getPosthogAccessToken(TEAM_ID, stale)

    expect(token.token).toBe('pha_reauthorized')
    expect(revoked).toEqual(['pha_new'])
    expect((await getPosthogAccessToken(TEAM_ID, latest)).token).toBe('pha_reauthorized')
    invalidatePosthogAccessToken(TEAM_ID, stale.id)
  })

  test('a rejected refresh on a replaced grant does not mark the new grant for reconnect', async () => {
    const stale = binding()

    matched = 0
    latest = binding({
      id: stale.id,
      encryptedAccessToken: seal('pha_reauthorized'),
      encryptedRefreshToken: seal('phr_reauthorized'),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    })
    refreshResult = () => Promise.reject(new PosthogApiError(400, 'invalid_grant', 'invalid_grant'))

    expect((await getPosthogAccessToken(TEAM_ID, stale)).token).toBe('pha_reauthorized')
    expect(updates[0]?.filter).toMatchObject({
      posthogIntegrations: { $elemMatch: { 'encryptedRefreshToken.ciphertext': 'phr_1' } },
    })
    invalidatePosthogAccessToken(TEAM_ID, stale.id)
  })
})
