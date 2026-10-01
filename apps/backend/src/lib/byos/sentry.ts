import { config } from '@/config'
import { encryptSentrySecret, decryptSentrySecret } from '@/lib/byos/secrets'
import { refreshTokens, SentryOAuthNotConfigured } from '@/lib/byos/sentry-oauth'
import { tokenStillFresh } from '@/lib/byos/token-freshness'
import { teamByosBindings } from '@/models'

import type { SentryAccountBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  parseTokenResponse,
  SentryApiError,
  SentryOAuthNotConfigured,
} from '@/lib/byos/sentry-oauth'
export type { AuthorizeUrlInput, ExchangedTokens, SentryAccount } from '@/lib/byos/sentry-oauth'

export const SENTRY_API_BASE_URL = 'https://sentry.io/api/0'

export function getDefaultClientCredentials(): { clientId: string; clientSecret: string } | null {
  const { clientId, clientSecret } = config.byos.sentry

  if (!clientId || !clientSecret) return null

  return { clientId, clientSecret }
}

export function getSetupRedirect(): string | null {
  return config.byos.sentry.setupRedirect ?? null
}

export function isSentryConfigured(): boolean {
  // Without the encryption key, /sentry-app/setup throws mid-handler in
  // encryptSentrySecret and the desktop install promise waits out its full
  // timeout instead of redirecting back into the app.
  return Boolean(
    config.byos.sentry.clientId &&
    config.byos.sentry.clientSecret &&
    config.byos.sentry.setupRedirect &&
    config.byos.sentry.encryptionKey,
  )
}

// ── Token refresh on demand (credential handout) ──

const cacheKey = (teamId: ObjectId, bindingId: ObjectId) =>
  `${teamId.toHexString()}:${bindingId.toHexString()}`

type CachedToken = { token: string; expiresAt: Date | null }
const accessTokenCache = new Map<string, CachedToken>()
const accessTokenInflight = new Map<string, Promise<string>>()

// Returns a valid Sentry access token for the binding, refreshing (and
// persisting the rotated tokens) when the stored one is within 60s of expiry.
export async function getAccessToken(
  teamId: ObjectId,
  binding: SentryAccountBinding,
): Promise<string> {
  const key = cacheKey(teamId, binding.id)
  const canRefresh = Boolean(binding.encryptedRefreshToken)
  const cached = accessTokenCache.get(key)

  if (cached && tokenStillFresh(cached.expiresAt, canRefresh)) return cached.token

  if (!cached && tokenStillFresh(binding.accessTokenExpiresAt, canRefresh)) {
    const token = decryptSentrySecret(binding.encryptedAccessToken)
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
      return decryptSentrySecret(binding.encryptedAccessToken)
    }
    const credentials = getDefaultClientCredentials()

    if (!credentials) throw new SentryOAuthNotConfigured()
    const refreshToken = decryptSentrySecret(binding.encryptedRefreshToken)
    const fresh = await refreshTokens(credentials.clientId, credentials.clientSecret, refreshToken)
    const encryptedAccessToken = encryptSentrySecret(fresh.accessToken)
    const encryptedRefreshToken = fresh.refreshToken
      ? encryptSentrySecret(fresh.refreshToken)
      : binding.encryptedRefreshToken
    // Optimistic-concurrency guard: only write back if the binding still holds
    // the expiry we started this refresh from. A re-bind (or a competing
    // refresh) replaces accessTokenExpiresAt, so a refresh that began before it
    // becomes a no-op instead of clobbering the newer tokens.
    const write = await teamByosBindings().updateOne(
      {
        _id: teamId,
        'sentryAccounts.id': binding.id,
        'sentryAccounts.accessTokenExpiresAt': binding.accessTokenExpiresAt,
      },
      {
        $set: {
          'sentryAccounts.$.encryptedAccessToken': encryptedAccessToken,
          'sentryAccounts.$.encryptedRefreshToken': encryptedRefreshToken,
          'sentryAccounts.$.accessTokenExpiresAt': fresh.expiresAt,
          'sentryAccounts.$.scope': fresh.scope || binding.scope,
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
  })()

  accessTokenInflight.set(key, refreshing)
  // Only clear the entry if it's still OURS. invalidateSentryAccessToken (or a
  // re-bind) can drop this key mid-flight and let a newer refresh claim it; an
  // unconditional delete would evict that newer promise and let a third refresh
  // start alongside it. Two concurrent refreshes both spend the same stored
  // refresh token, and because Sentry rotates it, the loser gets invalid_grant.
  // The .catch is on the derived promise only — `refreshing` itself still
  // rejects to the caller. Without it a failed refresh would surface as an
  // unhandled rejection here.
  void refreshing
    .finally(() => {
      if (accessTokenInflight.get(key) === refreshing) {
        accessTokenInflight.delete(key)
      }
    })
    .catch(() => {})

  return refreshing
}

export async function getAccessTokenWithExpiry(
  teamId: ObjectId,
  binding: SentryAccountBinding,
): Promise<{ token: string; expiresAt: Date | null }> {
  const token = await getAccessToken(teamId, binding)
  const cached = accessTokenCache.get(cacheKey(teamId, binding.id))

  return { token, expiresAt: cached?.expiresAt ?? binding.accessTokenExpiresAt ?? null }
}

// Drop any cached access token for a binding. Call after a re-bind (which
// replaces the stored tokens under the same binding id) or an unbind, so the
// next handout doesn't serve the pre-change token for up to ~30d (mirrors
// GitLab's invalidateAccessToken).
export function invalidateSentryAccessToken(teamId: ObjectId, bindingId: ObjectId): void {
  accessTokenCache.delete(cacheKey(teamId, bindingId))
  accessTokenInflight.delete(cacheKey(teamId, bindingId))
}

// NOTE: Sentry exposes no OAuth revocation endpoint — unlike Asana/GitLab there
// is no server-side way to kill a grant on unbind. Removing the binding stops
// Nuphos handing the token out, but any token already delivered to a sandbox
// stays valid at Sentry until it expires (~30d). Users who want the grant gone
// immediately must revoke it at Settings → Account → Authorized Applications.
