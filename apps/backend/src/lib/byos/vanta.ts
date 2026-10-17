import { decryptVantaSecret } from '@/lib/byos/secrets'
import { tokenStillFresh } from '@/lib/byos/token-freshness'
import { mintVantaClientCredentialsToken, VantaApiError } from '@/lib/byos/vanta-core'

import type { VantaIntegrationBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export {
  mintVantaClientCredentialsToken,
  VantaApiError,
  verifyVantaClientCredentials,
} from '@/lib/byos/vanta-core'
export { listVantaTests, VANTA_INFRA_CATEGORIES } from '@/lib/byos/vanta-tests'
export type { VantaTest } from '@/lib/byos/vanta-tests'

// ── Access-token cache + concurrency guard ─────────────────────────────────
// Vanta allows only ONE active access token per app — re-minting revokes the
// previous one. So we cache aggressively and mint only when the cached token is
// within 60s of expiry, and an in-flight map collapses concurrent mints (a
// double mint would revoke each other's token).

type CachedToken = { token: string; expiresAt: Date | null }
const accessTokenCache = new Map<string, CachedToken>()
const accessTokenInflight = new Map<string, Promise<string>>()

function cacheKey(teamId: ObjectId, bindingId: ObjectId): string {
  return `${teamId.toHexString()}:${bindingId.toHexString()}`
}

export function invalidateVantaAccessToken(teamId: ObjectId, bindingId: ObjectId): void {
  accessTokenCache.delete(cacheKey(teamId, bindingId))
}

/** A usable bearer token for a Vanta binding: minted (and cached) on demand
 * from its client credentials, so it can always be renewed. */
export async function getVantaAccessToken(
  teamId: ObjectId,
  binding: VantaIntegrationBinding,
): Promise<string> {
  const key = cacheKey(teamId, binding.id)
  const cached = accessTokenCache.get(key)

  if (cached && tokenStillFresh(cached.expiresAt, true)) return cached.token

  const inflight = accessTokenInflight.get(key)

  if (inflight) return inflight

  const resolving = (async () => {
    const cc = binding.clientCredentials

    if (!cc) throw new VantaApiError(500, 'Vanta binding has no client credentials')
    const minted = await mintVantaClientCredentialsToken(
      cc.clientId,
      decryptVantaSecret(cc.encryptedClientSecret),
    )

    accessTokenCache.set(key, { token: minted.accessToken, expiresAt: minted.expiresAt })

    return minted.accessToken
  })().finally(() => accessTokenInflight.delete(key))

  accessTokenInflight.set(key, resolving)

  return resolving
}
