import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { verifySecondFactor } from '@/lib/identity/mfa'
import { passkeyAssertionOptions } from '@/lib/identity/mfa-passkeys'
import { users } from '@/lib/identity/shared'
import { generateOpaqueToken, hashToken } from '@/lib/oauth/tokens'
import { ObjectId } from 'mongodb'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

// ── Sign-in challenge: what a sign-in returns instead of a session. ──

type MfaChallengeDoc = {
  _id: string
  userId: string
  expiresAt: Date
  /** Set when the app asks to answer with a passkey. */
  passkeyChallenge?: string
  /** Started by nuphos.ai's server, so the session is recorded as `startSession` would. */
  viaWebsite?: boolean
}

const mfaChallenges = () => db().collection<MfaChallengeDoc>('mfa_challenges')

export async function setupMfaChallengeIndexes(): Promise<void> {
  await mfaChallenges().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'mfa_challenges_ttl' },
  )
}

export async function createMfaChallenge(userId: string, viaWebsite = false): Promise<string> {
  const token = generateOpaqueToken()

  await mfaChallenges().insertOne({
    _id: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    ...(viaWebsite ? { viaWebsite } : {}),
  })

  return token
}

async function liveChallenge(mfaToken: unknown) {
  const _id = typeof mfaToken === 'string' && mfaToken ? hashToken(mfaToken) : null
  const challenge = _id
    ? await mfaChallenges().findOne({ _id, expiresAt: { $gt: new Date() } })
    : null

  if (!challenge) {
    throw new AppError(401, 'mfa_challenge_expired', 'This sign-in has expired. Sign in again.')
  }

  return challenge
}

/** To finish a sign-in with a passkey instead of a code. */
export async function mfaChallengePasskeyOptions(mfaToken: unknown) {
  const challenge = await liveChallenge(mfaToken)
  const user = await users().findOne(
    { _id: new ObjectId(challenge.userId) },
    { projection: { mfa: 1 } },
  )
  const options = await passkeyAssertionOptions(user?.mfa?.passkeys)

  await mfaChallenges().updateOne(
    { _id: challenge._id },
    { $set: { passkeyChallenge: options.challenge } },
  )

  return options
}

/** Whose sign-in a challenge was, once `code` passes; the challenge is then spent. */
export async function verifyMfaChallenge(
  mfaToken: unknown,
  code: unknown,
): Promise<{ userId: string; viaWebsite: boolean }> {
  const challenge = await liveChallenge(mfaToken)

  await verifySecondFactor(challenge.userId, code, challenge.passkeyChallenge ?? null)
  // A code is single-use, so only one request can get here per challenge; the
  // delete is what keeps a stolen token from being reused afterwards.
  if (!(await mfaChallenges().findOneAndDelete({ _id: challenge._id }))) {
    throw new AppError(401, 'mfa_challenge_expired', 'This sign-in has expired. Sign in again.')
  }

  return { userId: challenge.userId, viaWebsite: challenge.viaWebsite === true }
}
