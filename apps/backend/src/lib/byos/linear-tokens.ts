import { config } from '@/config'
import { findLinearWorkspace } from '@/lib/byos/account-integrations'
import { LinearApiError, LinearOAuthNotConfigured } from '@/lib/byos/linear-http'
import { refreshTokens } from '@/lib/byos/linear-oauth'
import { decryptLinearSecret, encryptLinearSecret } from '@/lib/byos/secrets'
import { tokenStillFresh } from '@/lib/byos/token-freshness'
import { teamByosBindings } from '@/models'

import type { LinearWorkspaceBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export class LinearReconnectRequired extends Error {
  constructor(reason: string) {
    super(`Linear authorization is no longer valid (${reason}); reconnect the Linear workspace`)
  }
}

export function getDefaultClientCredentials(): { clientId: string; clientSecret: string } | null {
  const { clientId, clientSecret } = config.byos.linear

  if (!clientId || !clientSecret) return null

  return { clientId, clientSecret }
}

type CachedToken = { token: string; expiresAt: Date | null }

const cacheKey = (teamId: ObjectId, bindingId: ObjectId) =>
  `${teamId.toHexString()}:${bindingId.toHexString()}`

const accessTokenCache = new Map<string, CachedToken>()
const accessTokenInflight = new Map<string, Promise<CachedToken>>()
// Every backend replica can refresh the same binding, and a token superseded by
// another replica's refresh can be rejected while its stored expiry still looks
// live, so a token Linear answered 401 to is never served again.
const rejectedTokens = new Map<string, string[]>()
const REJECTED_PER_BINDING = 4

export function invalidateAccessToken(teamId: ObjectId, bindingId: ObjectId): void {
  const key = cacheKey(teamId, bindingId)

  accessTokenCache.delete(key)
  accessTokenInflight.delete(key)
  rejectedTokens.delete(key)
}

function laterExpiry(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? 0) > (b?.getTime() ?? 0)
}

// The binding row is re-read from the DB on every request, so when another
// replica has refreshed, the row carries a newer token than this process's cache.
function currentToken(key: string, binding: LinearWorkspaceBinding): CachedToken {
  const stored: CachedToken = {
    token: decryptLinearSecret(binding.encryptedAccessToken),
    expiresAt: binding.accessTokenExpiresAt ?? null,
  }
  const cached = accessTokenCache.get(key)

  if (!cached || cached.token === stored.token || laterExpiry(stored.expiresAt, cached.expiresAt)) {
    return stored
  }

  return cached
}

function isGrantRejection(error: unknown): boolean {
  return error instanceof LinearApiError && (error.status === 400 || error.status === 401)
}

async function refreshBinding(
  teamId: ObjectId,
  binding: LinearWorkspaceBinding,
): Promise<CachedToken> {
  if (!binding.encryptedRefreshToken) {
    throw new LinearReconnectRequired('no refresh token stored')
  }
  const credentials = getDefaultClientCredentials()

  if (!credentials) throw new LinearOAuthNotConfigured()
  const refreshToken = decryptLinearSecret(binding.encryptedRefreshToken)
  const fresh = await refreshTokens(
    credentials.clientId,
    credentials.clientSecret,
    refreshToken,
  ).catch((error: unknown) => {
    if (isGrantRejection(error)) throw new LinearReconnectRequired('refresh token rejected')
    throw error
  })

  await teamByosBindings().updateOne(
    { _id: teamId, 'linearWorkspaces.id': binding.id },
    {
      $set: {
        'linearWorkspaces.$.encryptedAccessToken': encryptLinearSecret(fresh.accessToken),
        'linearWorkspaces.$.encryptedRefreshToken': fresh.refreshToken
          ? encryptLinearSecret(fresh.refreshToken)
          : binding.encryptedRefreshToken,
        'linearWorkspaces.$.accessTokenExpiresAt': fresh.expiresAt,
        'linearWorkspaces.$.scope': fresh.scope || binding.scope,
        updatedAt: new Date(),
      },
    },
  )

  return { token: fresh.accessToken, expiresAt: fresh.expiresAt }
}

async function resolveToken(
  teamId: ObjectId,
  binding: LinearWorkspaceBinding,
): Promise<CachedToken> {
  const key = cacheKey(teamId, binding.id)
  const canRefresh = Boolean(binding.encryptedRefreshToken)
  const current = currentToken(key, binding)
  const rejected = rejectedTokens.get(key)?.includes(current.token) ?? false

  if (!rejected && tokenStillFresh(current.expiresAt, canRefresh)) {
    accessTokenCache.set(key, current)

    return current
  }
  if (!canRefresh) {
    if (rejected) throw new LinearReconnectRequired('access token rejected and no refresh token')

    return current
  }

  const inflight = accessTokenInflight.get(key)

  if (inflight) return inflight

  const refreshing = refreshBinding(teamId, binding)
    .then((fresh) => {
      if (accessTokenInflight.get(key) === refreshing) accessTokenCache.set(key, fresh)

      return fresh
    })
    .finally(() => {
      // A re-bind can clear the slot mid-flight and let a newer refresh take it;
      // only retract our own entry so a third caller can't start a concurrent
      // refresh against an already-rotated refresh token.
      if (accessTokenInflight.get(key) === refreshing) accessTokenInflight.delete(key)
    })

  accessTokenInflight.set(key, refreshing)

  return refreshing
}

export async function getAccessTokenWithExpiry(
  teamId: ObjectId,
  binding: LinearWorkspaceBinding,
): Promise<{ token: string; expiresAt: Date | null }> {
  return resolveToken(teamId, binding)
}

export async function getAccessToken(
  teamId: ObjectId,
  binding: LinearWorkspaceBinding,
): Promise<string> {
  return (await resolveToken(teamId, binding)).token
}

// Runs a Linear call, and on a 401 retries once with the binding's current
// token: the one another replica stored, or a freshly refreshed one.
export async function withLinearAccessToken<T>(
  teamId: ObjectId,
  binding: LinearWorkspaceBinding,
  run: (token: string) => Promise<T>,
): Promise<T> {
  const key = cacheKey(teamId, binding.id)
  const first = await getAccessToken(teamId, binding)

  try {
    return await run(first)
  } catch (error) {
    rememberRejection(key, first, error)
  }

  const latest = (await findLinearWorkspace(teamId, binding.id)) ?? binding
  const retry = await getAccessToken(teamId, latest)

  try {
    return await run(retry)
  } catch (error) {
    rememberRejection(key, retry, error)
    throw new LinearReconnectRequired('retried access token rejected')
  }
}

function rememberRejection(key: string, token: string, error: unknown): void {
  if (!(error instanceof LinearApiError) || error.status !== 401) throw error
  rejectedTokens.set(
    key,
    [token, ...(rejectedTokens.get(key) ?? [])].slice(0, REJECTED_PER_BINDING),
  )
  if (accessTokenCache.get(key)?.token === token) accessTokenCache.delete(key)
}
