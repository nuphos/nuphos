import { logError } from '@/lib/observability'
import { personalCredentials } from '@/models'

import { revokeGithubToken } from './github'
import { GOOGLE_PROVIDERS, isGoogleProvider, revokeGoogleToken } from './google'
import { open } from './seal'

import type { PersonalCredential, PersonalCredentialProvider } from '@/models'

const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke'

async function revokeAtProvider(doc: PersonalCredential): Promise<void> {
  const token = open(doc.provider, doc.encryptedAccessToken)

  if (doc.provider === 'github') return revokeGithubToken(token)
  if (isGoogleProvider(doc.provider)) return revokeGoogleToken(token)
  await fetch(LINEAR_REVOKE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
}

/** Best-effort: deletes the grant at its provider. */
export function revokeQuietly(doc: PersonalCredential): Promise<void> {
  return revokeAtProvider(doc).catch((error: unknown) => {
    logError('personal_credential.revoke_failed', error, { provider: doc.provider })
  })
}

/** Gmail / Google Drive grants are per team, so removing one names the team. */
export async function deletePersonalCredential(
  userId: string,
  provider: PersonalCredentialProvider,
  teamId?: string,
): Promise<void> {
  const doc = await personalCredentials().findOneAndDelete({
    userId,
    provider,
    ...(isGoogleProvider(provider) ? { teamId } : {}),
  })

  if (!doc) return
  // One Google revoke ends both grants from that team's client, so keep it while another remains.
  if (
    isGoogleProvider(provider) &&
    (await personalCredentials().countDocuments({
      userId,
      teamId: doc.teamId,
      provider: { $in: [...GOOGLE_PROVIDERS] },
    }))
  ) {
    return
  }
  await revokeQuietly(doc)
}

export async function deleteAllPersonalCredentials(userId: string): Promise<void> {
  const docs = await personalCredentials()
    .find({ userId }, { projection: { provider: 1, teamId: 1 } })
    .toArray()

  // In turn, so the last Google grant of each team still sees it is the last and revokes.
  for (const doc of docs) await deletePersonalCredential(userId, doc.provider, doc.teamId)
}
