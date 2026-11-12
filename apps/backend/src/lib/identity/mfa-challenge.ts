import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { verifySecondFactor } from '@/lib/identity/mfa'
import { generateOpaqueToken, hashToken } from '@/lib/oauth/tokens'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

// ── Sign-in challenge: what a sign-in returns instead of a session. ──

type MfaChallengeDoc = { _id: string; userId: string; expiresAt: Date }

const mfaChallenges = () => db().collection<MfaChallengeDoc>('mfa_challenges')

export async function setupMfaChallengeIndexes(): Promise<void> {
  await mfaChallenges().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'mfa_challenges_ttl' },
  )
}

export async function createMfaChallenge(userId: string): Promise<string> {
  const token = generateOpaqueToken()

  await mfaChallenges().insertOne({
    _id: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  })

  return token
}

/** The user a challenge belongs to, once `code` passes; the challenge is then spent. */
export async function verifyMfaChallenge(mfaToken: unknown, code: unknown): Promise<string> {
  const _id = typeof mfaToken === 'string' && mfaToken ? hashToken(mfaToken) : null
  const challenge = _id
    ? await mfaChallenges().findOne({ _id, expiresAt: { $gt: new Date() } })
    : null

  if (!challenge) {
    throw new AppError(401, 'mfa_challenge_expired', 'This sign-in has expired. Sign in again.')
  }
  await verifySecondFactor(challenge.userId, code)
  // A code is single-use, so only one request can get here per challenge; the
  // delete is what keeps a stolen token from being reused afterwards.
  if (!(await mfaChallenges().findOneAndDelete({ _id: challenge._id }))) {
    throw new AppError(401, 'mfa_challenge_expired', 'This sign-in has expired. Sign in again.')
  }

  return challenge.userId
}
