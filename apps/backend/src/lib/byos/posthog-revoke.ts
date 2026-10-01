import { revokePosthogToken } from '@/lib/byos/posthog-oauth'
import { decryptPosthogSecret } from '@/lib/byos/secrets'
import { teamByosBindings } from '@/models'

import type { PosthogIntegrationBinding } from '@/models'

// PostHog answers a refresh-token revocation for a CIMD client by deleting every
// token of that (user, client) pair. When the new grant shares the client, or
// another binding holds a grant from the same user on it, that sweep would take
// those grants too, so only the old access token is revoked then.
async function refreshSweepIsSafe(
  previous: PosthogIntegrationBinding,
  current: PosthogIntegrationBinding,
): Promise<boolean> {
  if (previous.clientId === current.clientId) return false
  const sharing = await teamByosBindings().countDocuments({
    posthogIntegrations: {
      $elemMatch: {
        clientId: previous.clientId,
        userUuid: previous.userUuid,
        id: { $ne: previous.id },
      },
    },
  })

  return sharing === 0
}

/** Best effort: the new grant is already stored, so a failed revocation only lets the old tokens expire. */
export async function revokeReplacedGrant(
  previous: PosthogIntegrationBinding,
  current: PosthogIntegrationBinding,
): Promise<void> {
  const tokens: { token: string; hint: 'refresh_token' | 'access_token' }[] = []

  if (previous.encryptedAccessToken) {
    tokens.push({
      token: decryptPosthogSecret(previous.encryptedAccessToken),
      hint: 'access_token',
    })
  }
  if (previous.encryptedRefreshToken && (await refreshSweepIsSafe(previous, current))) {
    tokens.push({
      token: decryptPosthogSecret(previous.encryptedRefreshToken),
      hint: 'refresh_token',
    })
  }

  await Promise.allSettled(
    tokens.map((entry) =>
      revokePosthogToken({
        apiBaseUrl: previous.apiBaseUrl,
        clientId: previous.clientId,
        token: entry.token,
        hint: entry.hint,
      }),
    ),
  )
}
