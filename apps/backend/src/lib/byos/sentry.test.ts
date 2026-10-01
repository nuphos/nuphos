import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'

import {
  buildAuthorizeUrl,
  getAccessToken,
  invalidateSentryAccessToken,
  parseTokenResponse,
} from './sentry'

import type { EncryptedEnvelope, SentryAccountBinding } from '@/models'

const realFetch = globalThis.fetch

// Reaching the network means the handout fell through to a refresh, which is
// the whole point of these tests; a server that happens to have
// SENTRY_OAUTH_CLIENT_ID set must fail here rather than call Sentry.
beforeEach(() => {
  globalThis.fetch = (async (..._args: Parameters<typeof fetch>): Promise<Response> => {
    throw new Error('REFRESH_ATTEMPTED')
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const envelope = (ciphertext: string): EncryptedEnvelope => ({
  v: 1,
  alg: 'A256GCM',
  keyId: 'test',
  iv: 'iv',
  authTag: 'tag',
  ciphertext,
})

useByosSecrets({
  decryptSentrySecret: (env) => (env as EncryptedEnvelope).ciphertext,
  encryptSentrySecret: (plain) => envelope(plain as string),
})

// Shared across every test in this file: the cache is keyed by team+binding, so
// minting a new ObjectId per call would give each assertion its own key and let
// the re-bind test pass without ever consulting a cached entry.
const TEAM_ID = new ObjectId('69e989027ab63e8d6a0ffcb6')
const BINDING_ID = new ObjectId('69e989027ab63e8d6a0ffcb7')

function accountBinding(opts: {
  accessToken: string
  refreshToken: string | null
  accessTokenExpiresAt: Date | null
}): SentryAccountBinding {
  return {
    id: BINDING_ID,
    label: 'acme',
    userId: '1',
    userName: null,
    userEmail: null,
    scope: 'org:read',
    encryptedAccessToken: envelope(opts.accessToken),
    encryptedRefreshToken: opts.refreshToken === null ? null : envelope(opts.refreshToken),
    accessTokenExpiresAt: opts.accessTokenExpiresAt,
    createdAt: new Date(0),
  }
}

// Either outcome proves the handout stopped serving the stored token and went
// looking for a fresh one.
const REFRESH_ATTEMPTED = /REFRESH_ATTEMPTED|Sentry OAuth is not configured/

beforeEach(() => {
  invalidateSentryAccessToken(TEAM_ID, BINDING_ID)
})

describe('getAccessToken', () => {
  test('a stored token with unknown expiry is refreshed, not served forever', async () => {
    const binding = accountBinding({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      accessTokenExpiresAt: null,
    })

    await expect(getAccessToken(TEAM_ID, binding)).rejects.toThrow(REFRESH_ATTEMPTED)
  })

  test('an unknown expiry with nothing to refresh from still serves the stored token', async () => {
    const binding = accountBinding({
      accessToken: 'stored-access',
      refreshToken: null,
      accessTokenExpiresAt: null,
    })

    expect(await getAccessToken(TEAM_ID, binding)).toBe('stored-access')
  })

  test('a cached unknown expiry is re-examined once the binding can refresh', async () => {
    // Caches { expiresAt: null } under the shared key.
    await getAccessToken(
      TEAM_ID,
      accountBinding({
        accessToken: 'stored-access',
        refreshToken: null,
        accessTokenExpiresAt: null,
      }),
    )

    const rebound = accountBinding({
      accessToken: 'stored-access',
      refreshToken: 'granted-on-rebind',
      accessTokenExpiresAt: null,
    })

    await expect(getAccessToken(TEAM_ID, rebound)).rejects.toThrow(REFRESH_ATTEMPTED)
  })

  test('a live expiry is still served from cache without a refresh', async () => {
    const binding = accountBinding({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })

    expect(await getAccessToken(TEAM_ID, binding)).toBe('stored-access')
    expect(await getAccessToken(TEAM_ID, binding)).toBe('stored-access')
  })
})

describe('buildAuthorizeUrl', () => {
  test('targets the Sentry authorize endpoint with the required OAuth params', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'client-123',
        redirectUri: 'https://api.nuphos.ai/sentry-app/setup',
        state: 'abc123',
        scope: 'org:read project:read',
      }),
    )

    expect(url.origin + url.pathname).toBe('https://sentry.io/oauth/authorize/')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.nuphos.ai/sentry-app/setup')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('abc123')
    expect(url.searchParams.get('scope')).toBe('org:read project:read')
  })
})

describe('parseTokenResponse', () => {
  test('extracts tokens, expiry, scope, and the authorising user', () => {
    const before = Date.now()
    const out = parseTokenResponse({
      access_token: 'acc-tok',
      token_type: 'bearer',
      expires_in: 2591999,
      refresh_token: 'ref-tok',
      scope: 'org:read project:read',
      user: { id: 123, name: 'Jane Doe', email: 'jane@acme.com' },
    })

    expect(out.accessToken).toBe('acc-tok')
    expect(out.refreshToken).toBe('ref-tok')
    expect(out.scope).toBe('org:read project:read')
    // Sentry sends user.id as a number; the binding stores it as a string.
    expect(out.account).toEqual({ userId: '123', name: 'Jane Doe', email: 'jane@acme.com' })
    expect(out.expiresAt).not.toBeNull()
    const ms = out.expiresAt!.getTime()

    expect(ms).toBeGreaterThanOrEqual(before + 2591999 * 1000)
    expect(ms).toBeLessThanOrEqual(Date.now() + 2591999 * 1000)
  })

  test('takes the rotated refresh token from a refresh response over the stored one', () => {
    const out = parseTokenResponse(
      { access_token: 'new-acc', token_type: 'bearer', expires_in: 3600, refresh_token: 'rotated' },
      'stored-refresh',
    )

    expect(out.accessToken).toBe('new-acc')
    expect(out.refreshToken).toBe('rotated')
  })

  test('falls back to the stored refresh token if a refresh response omits one', () => {
    const out = parseTokenResponse(
      { access_token: 'new-acc', token_type: 'bearer', expires_in: 3600 },
      'stored-refresh',
    )

    expect(out.refreshToken).toBe('stored-refresh')
  })

  test('falls back to expires_at when expires_in is absent', () => {
    const out = parseTokenResponse({
      access_token: 'a',
      token_type: 'bearer',
      expires_at: '2026-11-27T23:20:21.054320Z',
    })

    expect(out.expiresAt?.toISOString()).toBe('2026-11-27T23:20:21.054Z')
  })

  test('prefers expires_in over expires_at when both are present', () => {
    const before = Date.now()
    const out = parseTokenResponse({
      access_token: 'a',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: '2000-01-01T00:00:00Z',
    })

    expect(out.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000)
  })

  test('expires_in: 0 yields an expired date, not a null (cache-forever) expiry', () => {
    const out = parseTokenResponse({
      access_token: 'a',
      token_type: 'bearer',
      expires_in: 0,
      expires_at: '2030-01-01T00:00:00Z',
    })

    expect(out.expiresAt).not.toBeNull()
    // Must not fall through to the far-future expires_at, and must not be null:
    // either would leave the token cached past its actual life.
    expect(out.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now())
  })

  test('null expiry when expires_at is unparseable rather than an Invalid Date', () => {
    const out = parseTokenResponse({
      access_token: 'a',
      token_type: 'bearer',
      expires_at: 'garbage',
    })

    expect(out.expiresAt).toBeNull()
  })

  test('keeps a zero user id rather than dropping the account', () => {
    const out = parseTokenResponse({ access_token: 'a', token_type: 'bearer', user: { id: 0 } })

    expect(out.account).toEqual({ userId: '0', name: null, email: null })
  })

  test('null refresh token and null account when neither is present', () => {
    const out = parseTokenResponse({ access_token: 'a', token_type: 'bearer' })

    expect(out.refreshToken).toBeNull()
    expect(out.account).toBeNull()
    expect(out.expiresAt).toBeNull()
    expect(out.scope).toBe('')
  })
})
