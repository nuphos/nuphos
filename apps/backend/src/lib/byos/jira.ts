import { encryptJiraSecret, decryptJiraSecret } from '@/lib/byos/secrets'
import { tokenStillFresh } from '@/lib/byos/token-freshness'
import { teamByosBindings } from '@/models'

import { getDefaultClientCredentials, JiraOAuthNotConfigured, refreshTokens } from './jira-oauth'

import type { JiraSiteBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getAccessibleResources,
  getDefaultClientCredentials,
  getSetupRedirect,
  isJiraConfigured,
  JiraApiError,
  JiraOAuthNotConfigured,
} from './jira-oauth'
export type { AtlassianSite, AuthorizeUrlInput, ExchangedTokens } from './jira-oauth'

// ── Token refresh on demand (credential handout) ──

const cacheKey = (teamId: ObjectId, bindingId: ObjectId) =>
  `${teamId.toHexString()}:${bindingId.toHexString()}`

type CachedToken = { token: string; expiresAt: Date | null }
const accessTokenCache = new Map<string, CachedToken>()
const accessTokenInflight = new Map<string, Promise<string>>()

// Drop any cached access token for a binding. Call after a re-bind (which
// replaces the stored tokens under the same binding id) or an unbind, so the
// next handout doesn't serve the pre-change token for up to ~1h (mirrors
// Asana's invalidateAsanaAccessToken).
export function invalidateAccessToken(teamId: ObjectId, bindingId: ObjectId): void {
  const key = cacheKey(teamId, bindingId)

  accessTokenCache.delete(key)
  accessTokenInflight.delete(key)
}

// Returns a valid Jira access token for the binding, refreshing (and persisting
// the rotated refresh token) when the stored one is within 60s of expiry.
export async function getAccessToken(teamId: ObjectId, binding: JiraSiteBinding): Promise<string> {
  const key = cacheKey(teamId, binding.id)
  const canRefresh = Boolean(binding.encryptedRefreshToken)
  const cached = accessTokenCache.get(key)

  if (cached && tokenStillFresh(cached.expiresAt, canRefresh)) return cached.token

  if (!cached && tokenStillFresh(binding.accessTokenExpiresAt, canRefresh)) {
    const token = decryptJiraSecret(binding.encryptedAccessToken)
    const out: CachedToken = { token, expiresAt: binding.accessTokenExpiresAt }

    accessTokenCache.set(key, out)

    return token
  }

  const inflight = accessTokenInflight.get(key)

  if (inflight) return inflight

  const refreshing = (async (): Promise<string> => {
    if (!binding.encryptedRefreshToken) {
      // No refresh token (offline_access not granted). Hand back the stored
      // access token; the agent surfaces a re-connect prompt if it's expired.
      return decryptJiraSecret(binding.encryptedAccessToken)
    }
    const credentials = getDefaultClientCredentials()

    if (!credentials) throw new JiraOAuthNotConfigured()
    const refreshToken = decryptJiraSecret(binding.encryptedRefreshToken)
    const fresh = await refreshTokens(credentials.clientId, credentials.clientSecret, refreshToken)
    const encryptedAccessToken = encryptJiraSecret(fresh.accessToken)
    const encryptedRefreshToken = fresh.refreshToken
      ? encryptJiraSecret(fresh.refreshToken)
      : binding.encryptedRefreshToken

    await teamByosBindings().updateOne(
      { _id: teamId, 'jiraSites.id': binding.id },
      {
        $set: {
          'jiraSites.$.encryptedAccessToken': encryptedAccessToken,
          'jiraSites.$.encryptedRefreshToken': encryptedRefreshToken,
          'jiraSites.$.accessTokenExpiresAt': fresh.expiresAt,
          'jiraSites.$.scope': fresh.scope || binding.scope,
          updatedAt: new Date(),
        },
      },
    )
    accessTokenCache.set(key, { token: fresh.accessToken, expiresAt: fresh.expiresAt })

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
  binding: JiraSiteBinding,
): Promise<{ token: string; expiresAt: Date | null }> {
  const token = await getAccessToken(teamId, binding)
  // A cached entry always describes the token just handed back, including when
  // its expiry is null; only fall back to the binding when there is no entry.
  const cached = accessTokenCache.get(cacheKey(teamId, binding.id))

  return { token, expiresAt: cached ? cached.expiresAt : (binding.accessTokenExpiresAt ?? null) }
}
