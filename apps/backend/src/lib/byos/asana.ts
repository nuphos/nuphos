import { encryptAsanaSecret, decryptAsanaSecret } from '@/lib/byos/secrets'
import { tokenStillFresh } from '@/lib/byos/token-freshness'
import { teamByosBindings } from '@/models'

import { AsanaOAuthNotConfigured, getDefaultClientCredentials, refreshTokens } from './asana-oauth'

import type { AsanaAccountBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export {
  ASANA_API_BASE_URL,
  AsanaApiError,
  AsanaOAuthNotConfigured,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getDefaultClientCredentials,
  getSetupRedirect,
  isAsanaConfigured,
  parseTokenResponse,
  revokeGrant,
} from './asana-oauth'
export type { AsanaAccount, AuthorizeUrlInput, ExchangedTokens } from './asana-oauth'

// ── Token refresh on demand (credential handout) ──

const cacheKey = (teamId: ObjectId, bindingId: ObjectId) =>
  `${teamId.toHexString()}:${bindingId.toHexString()}`

type CachedToken = { token: string; expiresAt: Date | null }
const accessTokenCache = new Map<string, CachedToken>()
const accessTokenInflight = new Map<string, Promise<string>>()

// Returns a valid Asana access token for the binding, refreshing (and
// persisting the new access token) when the stored one is within 60s of expiry.
export async function getAccessToken(
  teamId: ObjectId,
  binding: AsanaAccountBinding,
): Promise<string> {
  const key = cacheKey(teamId, binding.id)
  const canRefresh = Boolean(binding.encryptedRefreshToken)
  const cached = accessTokenCache.get(key)

  if (cached && tokenStillFresh(cached.expiresAt, canRefresh)) return cached.token

  if (!cached && tokenStillFresh(binding.accessTokenExpiresAt, canRefresh)) {
    const token = decryptAsanaSecret(binding.encryptedAccessToken)
    const out: CachedToken = { token, expiresAt: binding.accessTokenExpiresAt }

    accessTokenCache.set(key, out)

    return token
  }

  const inflight = accessTokenInflight.get(key)

  if (inflight) return inflight

  const refreshing = (async (): Promise<string> => {
    if (!binding.encryptedRefreshToken) {
      // No refresh token stored. Hand back the stored access token; the agent
      // surfaces a re-connect prompt if it's expired.
      return decryptAsanaSecret(binding.encryptedAccessToken)
    }
    const credentials = getDefaultClientCredentials()

    if (!credentials) throw new AsanaOAuthNotConfigured()
    const refreshToken = decryptAsanaSecret(binding.encryptedRefreshToken)
    const fresh = await refreshTokens(credentials.clientId, credentials.clientSecret, refreshToken)
    const encryptedAccessToken = encryptAsanaSecret(fresh.accessToken)
    const encryptedRefreshToken = fresh.refreshToken
      ? encryptAsanaSecret(fresh.refreshToken)
      : binding.encryptedRefreshToken
    // Optimistic-concurrency guard: only write back if the binding still holds
    // the expiry we started this refresh from. A re-bind (or a competing
    // refresh) replaces accessTokenExpiresAt, so a refresh that began before it
    // becomes a no-op instead of clobbering the newer tokens.
    const write = await teamByosBindings().updateOne(
      {
        _id: teamId,
        'asanaAccounts.id': binding.id,
        'asanaAccounts.accessTokenExpiresAt': binding.accessTokenExpiresAt,
      },
      {
        $set: {
          'asanaAccounts.$.encryptedAccessToken': encryptedAccessToken,
          'asanaAccounts.$.encryptedRefreshToken': encryptedRefreshToken,
          'asanaAccounts.$.accessTokenExpiresAt': fresh.expiresAt,
          'asanaAccounts.$.scope': fresh.scope || binding.scope,
          updatedAt: new Date(),
        },
      },
    )

    // Only cache the refreshed token if our write actually landed. If the guard
    // didn't match, the binding was re-bound (or refreshed) concurrently — don't
    // poison the cache; hand this token to the current caller and let the next
    // call read the newer stored token.
    if (write.matchedCount > 0) {
      accessTokenCache.set(key, { token: fresh.accessToken, expiresAt: fresh.expiresAt })
    }

    return fresh.accessToken
  })().finally(() => {
    // Only retract our own entry — a re-bind can clear the map mid-flight and
    // let a newer refresh take the slot (see linear.ts for the full rationale).
    if (accessTokenInflight.get(key) === refreshing) accessTokenInflight.delete(key)
  })

  accessTokenInflight.set(key, refreshing)

  return refreshing
}

export async function getAccessTokenWithExpiry(
  teamId: ObjectId,
  binding: AsanaAccountBinding,
): Promise<{ token: string; expiresAt: Date | null }> {
  const token = await getAccessToken(teamId, binding)
  // A cached entry always describes the token just handed back, including when
  // its expiry is null; only fall back to the binding when there is no entry.
  const cached = accessTokenCache.get(cacheKey(teamId, binding.id))

  return { token, expiresAt: cached ? cached.expiresAt : (binding.accessTokenExpiresAt ?? null) }
}

// Drop any cached access token for a binding. Call after a re-bind (which
// replaces the stored tokens under the same binding id) or an unbind, so the
// next handout doesn't serve the pre-change token for up to ~1h (mirrors
// GitLab's invalidateAccessToken).
export function invalidateAsanaAccessToken(teamId: ObjectId, bindingId: ObjectId): void {
  accessTokenCache.delete(cacheKey(teamId, bindingId))
  accessTokenInflight.delete(cacheKey(teamId, bindingId))
}
