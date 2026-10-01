import { decryptGitlabSecret, encryptGitlabSecret } from '@/lib/byos/secrets'
import { tokenStillFresh } from '@/lib/byos/token-freshness'
import { teamByosBindings } from '@/models'

import { GitlabApiError, GitlabOAuthNotConfigured, USER_AGENT, gitlabFetch } from './http'
import { getDefaultClientCredentials, refreshTokens } from './oauth'

import type { GitlabBinding } from '@/models'
import type { ObjectId } from 'mongodb'

// ── Access-token cache + per-binding refresh ──

type CachedToken = { token: string; expiresAt: Date | null }
const accessTokenCache = new Map<string, CachedToken>()
const accessTokenInflight = new Map<string, Promise<string>>()

function cacheKey(teamId: ObjectId, bindingId: ObjectId): string {
  return `${teamId.toHexString()}:${bindingId.toHexString()}`
}

// Tokens that just produced a 401 land here so the next getAccessToken call
// is forced down the refresh-token path rather than re-reading the same dead
// token out of the DB. Keyed by the *plaintext* token value because the DB
// row's `accessTokenExpiresAt` still looks valid from our side — GitLab is
// the only source of truth that the token has been revoked.
const knownBadTokens = new Set<string>()
const KNOWN_BAD_MAX = 1024

function markTokenBad(token: string) {
  // Cheap cap so a misconfigured binding can't grow the set unboundedly. The
  // size is generous — a binding only adds at most one entry per revocation.
  if (knownBadTokens.size >= KNOWN_BAD_MAX) {
    const first = knownBadTokens.values().next().value

    if (first !== undefined) knownBadTokens.delete(first)
  }
  knownBadTokens.add(token)
}

// Call when a token is known to be dead (an API call 401'd with it): evicts it
// and marks it bad so the next handout can't re-read it from the DB.
export function invalidateAccessToken(teamId: ObjectId, bindingId: ObjectId): void {
  const key = cacheKey(teamId, bindingId)
  const cached = accessTokenCache.get(key)

  if (cached) markTokenBad(cached.token)
  accessTokenCache.delete(key)
}

// Call after a re-bind replaces the stored tokens under the same binding id, so
// the next handout re-reads the DB instead of serving the superseded grant's
// token. Deliberately does NOT mark the old token bad: it is superseded, not
// proven revoked, and the known-bad set guards the DB-shortcut — which now
// holds a different token anyway.
export function evictCachedAccessToken(teamId: ObjectId, bindingId: ObjectId): void {
  const key = cacheKey(teamId, bindingId)

  accessTokenCache.delete(key)
  accessTokenInflight.delete(key)
}

export async function getAccessToken(teamId: ObjectId, binding: GitlabBinding): Promise<string> {
  const key = cacheKey(teamId, binding.id)
  const canRefresh = Boolean(binding.encryptedRefreshToken)
  const cached = accessTokenCache.get(key)

  if (cached && tokenStillFresh(cached.expiresAt, canRefresh)) return cached.token

  // If we still have plenty of life on the DB-stored access token (no refresh
  // token, or expiry far enough out), prefer the persisted value over a
  // network refresh. We skip this shortcut if the DB token is in the
  // known-bad set — that means a recent API call got a 401 with it, so
  // re-reading it would loop on 401s until the natural TTL lapses.
  if (!cached && tokenStillFresh(binding.accessTokenExpiresAt, canRefresh)) {
    const token = decryptGitlabSecret(binding.encryptedAccessToken)

    if (!knownBadTokens.has(token)) {
      const out: CachedToken = { token, expiresAt: binding.accessTokenExpiresAt }

      accessTokenCache.set(key, out)

      return token
    }
  }

  const inflight = accessTokenInflight.get(key)

  if (inflight) return inflight

  const refreshing = (async (): Promise<string> => {
    if (!binding.encryptedRefreshToken) {
      // No refresh token — fall back to the (possibly stale) access token.
      // If the DB token is known-bad we must not re-cache it; otherwise
      // apiRequest would 401, invalidateAccessToken would re-mark it bad,
      // and the next call would loop right back here.
      const token = decryptGitlabSecret(binding.encryptedAccessToken)

      if (knownBadTokens.has(token)) {
        throw new GitlabApiError(401, 'GitLab access token revoked and no refresh token available')
      }
      accessTokenCache.set(key, { token, expiresAt: binding.accessTokenExpiresAt })

      return token
    }
    const refreshToken = decryptGitlabSecret(binding.encryptedRefreshToken)
    const clientId = binding.clientId
    const clientSecret = binding.encryptedClientSecret
      ? decryptGitlabSecret(binding.encryptedClientSecret)
      : getDefaultClientCredentials()?.clientSecret

    if (!clientSecret) {
      throw new GitlabOAuthNotConfigured()
    }
    const fresh = await refreshTokens(binding.hostUrl, clientId, clientSecret, refreshToken)

    // The freshly minted token replaces whatever was in known-bad; we don't
    // want a stale entry to make a future invalidate-then-getAccessToken loop
    // skip the new token as well.
    knownBadTokens.delete(fresh.accessToken)
    const encryptedAccessToken = encryptGitlabSecret(fresh.accessToken)
    const encryptedRefreshToken = fresh.refreshToken
      ? encryptGitlabSecret(fresh.refreshToken)
      : binding.encryptedRefreshToken

    await teamByosBindings().updateOne(
      { _id: teamId, 'gitlabAccounts.id': binding.id },
      {
        $set: {
          'gitlabAccounts.$.encryptedAccessToken': encryptedAccessToken,
          'gitlabAccounts.$.encryptedRefreshToken': encryptedRefreshToken,
          'gitlabAccounts.$.accessTokenExpiresAt': fresh.expiresAt,
          'gitlabAccounts.$.scope': fresh.scope || binding.scope,
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

// Token + expiry view for the agent-facing /token route. Reads the cache
// populated by getAccessToken so a just-refreshed token reports its real
// expiry rather than the (already overwritten) DB snapshot.
export async function getAccessTokenWithExpiry(
  teamId: ObjectId,
  binding: GitlabBinding,
): Promise<{ token: string; expiresAt: Date | null }> {
  const token = await getAccessToken(teamId, binding)
  // A cached entry always describes the token just handed back, including when
  // its expiry is null; only fall back to the binding when there is no entry.
  const cached = accessTokenCache.get(cacheKey(teamId, binding.id))

  return { token, expiresAt: cached ? cached.expiresAt : (binding.accessTokenExpiresAt ?? null) }
}

// ── Authenticated API helpers ──

// Only plain-object headers: the merge below spreads them, which silently
// drops a `Headers` instance or an entry-pair array.
type GitlabRequestInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }

export async function apiRequest<T>(
  teamId: ObjectId,
  binding: GitlabBinding,
  path: string,
  init?: GitlabRequestInit,
): Promise<T> {
  const token = await getAccessToken(teamId, binding)
  const host = binding.hostUrl
  const res = await gitlabFetch(`${host}/api/v4${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  })

  if (res.status === 401) {
    // Token may have been revoked or rotated outside our knowledge — clear
    // cache and let the caller surface the failure.
    invalidateAccessToken(teamId, binding.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')

    throw new GitlabApiError(res.status, `GitLab API ${path} failed: ${String(res.status)} ${text}`)
  }
  if (res.status === 204) return undefined as T

  return (await res.json()) as T
}
