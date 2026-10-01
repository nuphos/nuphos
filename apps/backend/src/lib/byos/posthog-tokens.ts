import { findPosthogIntegration } from '@/lib/byos/account-integrations'
import { decryptPosthogSecret, encryptPosthogSecret } from '@/lib/byos/secrets'
import { tokenStillFresh } from '@/lib/byos/token-freshness'
import { teamByosBindings } from '@/models'

import { refreshPosthogTokens, revokePosthogToken } from '@/lib/byos/posthog-oauth'
import { PosthogApiError } from './posthog-request'

import type { EncryptedEnvelope, PosthogIntegrationBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export class PosthogReconnectRequired extends Error {
  constructor(reason: string) {
    super(`PostHog authorization is no longer valid (${reason}); reconnect PostHog`)
  }
}

type CachedToken = { token: string; expiresAt: Date | null }

const cacheKey = (teamId: ObjectId, bindingId: ObjectId) =>
  `${teamId.toHexString()}:${bindingId.toHexString()}`

const accessTokenCache = new Map<string, CachedToken>()
const accessTokenInflight = new Map<string, Promise<CachedToken>>()
const rejectedTokens = new Map<string, string[]>()
const REJECTED_PER_BINDING = 4

export function invalidatePosthogAccessToken(teamId: ObjectId, bindingId: ObjectId): void {
  const key = cacheKey(teamId, bindingId)

  accessTokenCache.delete(key)
  accessTokenInflight.delete(key)
  rejectedTokens.delete(key)
}

function laterExpiry(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? 0) > (b?.getTime() ?? 0)
}

// The binding is re-read per request, so a row refreshed by another replica
// carries a newer token than this process's cache.
function currentToken(
  key: string,
  binding: PosthogIntegrationBinding,
  encryptedAccessToken: EncryptedEnvelope,
): CachedToken {
  const stored: CachedToken = {
    token: decryptPosthogSecret(encryptedAccessToken),
    expiresAt: binding.accessTokenExpiresAt,
  }
  const cached = accessTokenCache.get(key)

  if (!cached || cached.token === stored.token || laterExpiry(stored.expiresAt, cached.expiresAt)) {
    return stored
  }

  return cached
}

// Raised when the binding's grant was replaced (reconnect / Edit permissions)
// while a refresh ran against the older snapshot.
class PosthogGrantSuperseded extends Error {}

// Matches the binding only while it still holds the grant this snapshot saw.
function sameGrant(teamId: ObjectId, binding: PosthogIntegrationBinding) {
  return {
    _id: teamId,
    posthogIntegrations: {
      $elemMatch: {
        id: binding.id,
        'encryptedRefreshToken.ciphertext': binding.encryptedRefreshToken?.ciphertext ?? null,
      },
    },
  }
}

async function markReconnectRequired(
  teamId: ObjectId,
  binding: PosthogIntegrationBinding,
  reason: string,
): Promise<never> {
  const write = await teamByosBindings().updateOne(sameGrant(teamId, binding), {
    $set: { 'posthogIntegrations.$.reconnectRequired': true, updatedAt: new Date() },
  })

  if (write.matchedCount === 0) throw new PosthogGrantSuperseded()
  invalidatePosthogAccessToken(teamId, binding.id)
  throw new PosthogReconnectRequired(reason)
}

async function refreshBinding(
  teamId: ObjectId,
  binding: PosthogIntegrationBinding,
): Promise<CachedToken> {
  if (!binding.encryptedRefreshToken) {
    return await markReconnectRequired(teamId, binding, 'no refresh token stored')
  }
  let fresh

  try {
    fresh = await refreshPosthogTokens({
      apiBaseUrl: binding.apiBaseUrl,
      clientId: binding.clientId,
      refreshToken: decryptPosthogSecret(binding.encryptedRefreshToken),
    })
  } catch (error) {
    if (error instanceof PosthogApiError && (error.status === 400 || error.status === 401)) {
      return await markReconnectRequired(teamId, binding, 'refresh token rejected')
    }
    throw error
  }

  // Guarded on the refresh token we spent: a grant replaced meanwhile must win,
  // and the token just minted from the old one must not be handed out.
  const write = await teamByosBindings().updateOne(sameGrant(teamId, binding), {
    $set: {
      'posthogIntegrations.$.encryptedAccessToken': encryptPosthogSecret(fresh.accessToken),
      'posthogIntegrations.$.encryptedRefreshToken': fresh.refreshToken
        ? encryptPosthogSecret(fresh.refreshToken)
        : binding.encryptedRefreshToken,
      'posthogIntegrations.$.accessTokenExpiresAt': fresh.expiresAt,
      'posthogIntegrations.$.scope': fresh.scope || binding.scope,
      updatedAt: new Date(),
    },
  })

  if (write.matchedCount === 0) {
    await revokePosthogToken({
      apiBaseUrl: binding.apiBaseUrl,
      clientId: binding.clientId,
      token: fresh.accessToken,
      hint: 'access_token',
    }).catch(() => undefined)
    throw new PosthogGrantSuperseded()
  }

  return { token: fresh.accessToken, expiresAt: fresh.expiresAt }
}

async function resolveAgainstLatest(
  teamId: ObjectId,
  binding: PosthogIntegrationBinding,
): Promise<CachedToken> {
  const latest = await findPosthogIntegration(teamId, binding.id)

  if (!latest) throw new PosthogReconnectRequired('binding removed')

  return await resolveToken(teamId, latest)
}

async function resolveToken(
  teamId: ObjectId,
  binding: PosthogIntegrationBinding,
): Promise<CachedToken> {
  if (binding.reconnectRequired) throw new PosthogReconnectRequired('marked for reconnect')
  if (!binding.encryptedAccessToken) throw new PosthogReconnectRequired('no OAuth grant stored')
  const key = cacheKey(teamId, binding.id)
  const current = currentToken(key, binding, binding.encryptedAccessToken)
  const rejected = rejectedTokens.get(key)?.includes(current.token) ?? false

  if (!rejected && tokenStillFresh(current.expiresAt, true)) {
    accessTokenCache.set(key, current)

    return current
  }

  const inflight = accessTokenInflight.get(key)

  if (inflight) return inflight

  const refreshing: Promise<CachedToken> = refreshBinding(teamId, binding)
    .then((fresh) => {
      if (accessTokenInflight.get(key) === refreshing) accessTokenCache.set(key, fresh)

      return fresh
    })
    .catch(async (error: unknown) => {
      if (!(error instanceof PosthogGrantSuperseded)) throw error
      if (accessTokenInflight.get(key) === refreshing) accessTokenInflight.delete(key)

      return await resolveAgainstLatest(teamId, binding)
    })
    .finally(() => {
      if (accessTokenInflight.get(key) === refreshing) accessTokenInflight.delete(key)
    })

  accessTokenInflight.set(key, refreshing)

  return refreshing
}

export async function getPosthogAccessToken(
  teamId: ObjectId,
  binding: PosthogIntegrationBinding,
): Promise<{ token: string; expiresAt: Date | null }> {
  return await resolveToken(teamId, binding)
}

// Runs a PostHog call, and on a 401 retries once with the binding's current
// token: the one another replica stored, or a freshly refreshed one.
export async function withPosthogAccessToken<T>(
  teamId: ObjectId,
  binding: PosthogIntegrationBinding,
  run: (token: string) => Promise<T>,
): Promise<T> {
  const key = cacheKey(teamId, binding.id)
  const first = (await resolveToken(teamId, binding)).token

  try {
    return await run(first)
  } catch (error) {
    rememberRejection(key, first, error)
  }

  const latest = (await findPosthogIntegration(teamId, binding.id)) ?? binding
  const retry = (await resolveToken(teamId, latest)).token

  try {
    return await run(retry)
  } catch (error) {
    rememberRejection(key, retry, error)

    return await markReconnectRequired(teamId, latest, 'retried access token rejected')
  }
}

function rememberRejection(key: string, token: string, error: unknown): void {
  if (!(error instanceof PosthogApiError) || error.status !== 401) throw error
  rejectedTokens.set(
    key,
    [token, ...(rejectedTokens.get(key) ?? [])].slice(0, REJECTED_PER_BINDING),
  )
  if (accessTokenCache.get(key)?.token === token) accessTokenCache.delete(key)
}
