import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'

import { getVantaAccessToken, invalidateVantaAccessToken } from './vanta'

import type { EncryptedEnvelope, VantaIntegrationBinding } from '@/models'

const realFetch = globalThis.fetch

// Reaching the network means the handout fell through to a refresh, which is
// the whole point of these tests; a server that happens to have
// VANTA_OAUTH_CLIENT_ID set must fail here rather than call Vanta.
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
  decryptVantaSecret: (env) => (env as EncryptedEnvelope).ciphertext,
  encryptVantaSecret: (plain) => envelope(plain as string),
})

// Shared across every test in this file: the cache is keyed by team+binding, so
// minting a new ObjectId per call would give each assertion its own key and let
// the re-bind test pass without ever consulting a cached entry.
const TEAM_ID = new ObjectId('69e989027ab63e8d6a0ffcb6')
const BINDING_ID = new ObjectId('69e989027ab63e8d6a0ffcb7')

function oauthBinding(opts: {
  accessToken: string
  refreshToken: string | null
  accessTokenExpiresAt: Date | null
}): VantaIntegrationBinding {
  return {
    id: BINDING_ID,
    label: 'acme',
    orgDisplayName: 'Acme',
    authType: 'oauth',
    oauth: {
      clientId: 'vanta-client',
      scope: 'connectors.self:read-resource',
      encryptedAccessToken: envelope(opts.accessToken),
      encryptedRefreshToken: opts.refreshToken === null ? null : envelope(opts.refreshToken),
      accessTokenExpiresAt: opts.accessTokenExpiresAt,
    },
    createdAt: new Date(0),
  }
}

// Either outcome proves the handout stopped serving the stored token and went
// looking for a fresh one.
const REFRESH_ATTEMPTED = /REFRESH_ATTEMPTED|Vanta OAuth client is not configured/

beforeEach(() => {
  invalidateVantaAccessToken(TEAM_ID, BINDING_ID)
})

describe('getVantaAccessToken', () => {
  test('a stored token with unknown expiry is refreshed, not served forever', async () => {
    const binding = oauthBinding({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      accessTokenExpiresAt: null,
    })

    await expect(getVantaAccessToken(TEAM_ID, binding)).rejects.toThrow(REFRESH_ATTEMPTED)
  })

  test('an unknown expiry with nothing to refresh from still serves the stored token', async () => {
    const binding = oauthBinding({
      accessToken: 'stored-access',
      refreshToken: null,
      accessTokenExpiresAt: null,
    })

    expect(await getVantaAccessToken(TEAM_ID, binding)).toBe('stored-access')
  })

  test('a cached unknown expiry is re-examined once the binding can refresh', async () => {
    // Caches { expiresAt: null } under the shared key.
    await getVantaAccessToken(
      TEAM_ID,
      oauthBinding({
        accessToken: 'stored-access',
        refreshToken: null,
        accessTokenExpiresAt: null,
      }),
    )

    const rebound = oauthBinding({
      accessToken: 'stored-access',
      refreshToken: 'granted-on-rebind',
      accessTokenExpiresAt: null,
    })

    await expect(getVantaAccessToken(TEAM_ID, rebound)).rejects.toThrow(REFRESH_ATTEMPTED)
  })

  test('a live expiry is still served from cache without a refresh', async () => {
    const binding = oauthBinding({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })

    expect(await getVantaAccessToken(TEAM_ID, binding)).toBe('stored-access')
    expect(await getVantaAccessToken(TEAM_ID, binding)).toBe('stored-access')
  })
})
