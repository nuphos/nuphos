import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { users } from '@/lib/identity/shared'

// Bump when the recipients, data, or purposes in the iOS disclosure change.
// Shipped iOS and Android clients send this exact value, and the auth middleware rejects any
// other, so bump it only after clients that show the new notice are live.
export const AI_CONSENT_VERSION = '2026-09-28'

// The notices a client may show (#4853): shipped iOS 0.50.0 and Android 1.21.0 show 2026-09-28,
// newer builds 2026-11-23. Dates, so a later notice sorts after an earlier one.
const SHOWN_VERSIONS = [AI_CONSENT_VERSION, '2026-11-23']

/** The notice a client says it shows, when it is one the backend knows. */
export function shownConsentVersion(sent: unknown): string | undefined {
  return SHOWN_VERSIONS.find((version) => version === sent)
}

/** Consent for the notice `shown`, AI_CONSENT_VERSION by default. Agreeing to a later notice covers
 * an earlier one, so a person on a new and an old client is not asked again on each. */
export async function readAIConsent(userId: string, shown = AI_CONSENT_VERSION) {
  const user = await users().findOne({ _id: new ObjectId(userId), deletedAt: { $exists: false } })

  if (!user) throw new AppError(401, 'unauthorized', 'Account is no longer available')
  const saved = user.aiConsent

  return { version: shown, accepted: Boolean(saved?.accepted && saved.version >= shown) }
}

export async function saveAIConsent(userId: string, input: unknown) {
  const body = input as { version?: unknown; accepted?: unknown } | null
  const version = shownConsentVersion(body?.version)

  if (!version || typeof body?.accepted !== 'boolean') {
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
        aiConsent: { version, accepted: body.accepted, updatedAt: new Date() },
      },
    },
  )

  if (!result.matchedCount)
    throw new AppError(401, 'unauthorized', 'Account is no longer available')

  return { version, accepted: body.accepted }
}
