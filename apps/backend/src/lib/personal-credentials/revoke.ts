import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
import { personalCredentials } from '@/models'

import { deleteComposioAccount } from './composio'
import { revokeGithubToken } from './github'
import { GOOGLE_PROVIDERS, isGoogleProvider, revokeGoogleToken } from './google'
import { open } from './seal'

import type { PersonalCredential, PersonalCredentialProvider } from '@/models'

const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke'

async function revokeAtProvider(doc: PersonalCredential): Promise<void> {
  if (doc.composioAccountId) return deleteComposioAccount(doc.composioAccountId)
  if (!doc.encryptedAccessToken) return
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

/**
 * Removes one of a member's connections. A member may hold several accounts of a provider, so
 * removing one names the connection when there is more than one. Google accounts are per team.
 */
export async function deletePersonalCredential(
  userId: string,
  provider: PersonalCredentialProvider,
  teamId?: string,
  connectionId?: string,
): Promise<void> {
  if (connectionId && !ObjectId.isValid(connectionId)) {
    throw new AppError(404, 'personal_credential_account_not_found', 'No such connected account')
  }
  const filter = {
    userId,
    provider,
    ...(isGoogleProvider(provider) ? { teamId } : {}),
    ...(connectionId ? { _id: ObjectId.createFromHexString(connectionId) } : {}),
  }

  if (!connectionId && (await personalCredentials().countDocuments(filter)) > 1) {
    throw new AppError(
      409,
      'personal_credential_account_required',
      'Several accounts are connected: name the one to disconnect with connectionId',
    )
  }
  const doc = await personalCredentials().findOneAndDelete(filter)

  if (!doc) return
  // One Google revoke ends both grants of that Google account from the team's client, so keep
  // it while another provider of the same account remains. Each Composio connection is its own
  // and always goes.
  if (
    !doc.composioAccountId &&
    isGoogleProvider(provider) &&
    (await personalCredentials().countDocuments({
      userId,
      teamId: doc.teamId,
      providerUserId: doc.providerUserId,
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
  for (const doc of docs) {
    await deletePersonalCredential(userId, doc.provider, doc.teamId, doc._id.toHexString())
  }
}
