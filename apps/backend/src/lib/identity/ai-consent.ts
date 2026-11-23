import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { users } from '@/lib/identity/shared'

// Bump when the recipients, data, or purposes in the iOS disclosure change.
// Shipped iOS and Android clients send this exact value, and the auth middleware rejects any
// other, so bump it only after clients that show the new notice are live.
export const AI_CONSENT_VERSION = '2026-09-28'

export async function readAIConsent(userId: string) {
  const user = await users().findOne({ _id: new ObjectId(userId), deletedAt: { $exists: false } })

  if (!user) throw new AppError(401, 'unauthorized', 'Account is no longer available')

  return {
    version: AI_CONSENT_VERSION,
    accepted: user.aiConsent?.version === AI_CONSENT_VERSION && user.aiConsent.accepted,
  }
}

export async function saveAIConsent(userId: string, input: unknown) {
  const body = input as { version?: unknown; accepted?: unknown } | null

  if (body?.version !== AI_CONSENT_VERSION || typeof body.accepted !== 'boolean') {
    throw new AppError(
      400,
      'invalid_consent',
      'Read the current AI data sharing notice before continuing',
    )
  }
  const result = await users().updateOne(
    { _id: new ObjectId(userId), deletedAt: { $exists: false } },
    {
      $set: {
        aiConsent: { version: AI_CONSENT_VERSION, accepted: body.accepted, updatedAt: new Date() },
      },
    },
  )

  if (!result.matchedCount)
    throw new AppError(401, 'unauthorized', 'Account is no longer available')

  return { version: AI_CONSENT_VERSION, accepted: body.accepted }
}
