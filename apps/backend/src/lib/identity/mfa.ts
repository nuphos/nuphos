import { randomBytes } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { sealers } from '@/lib/byos/secrets'
import { db } from '@/lib/db'
import { escapeHtml, isEmailConfigured, sendEmail } from '@/lib/email'
import { AppError } from '@/lib/errors'
import {
  base32Decode,
  base32Encode,
  matchTotp,
  newRecoveryCodes,
  normalizeRecoveryCode,
  otpauthUrl,
} from '@/lib/identity/mfa-codes'
import { users } from '@/lib/identity/shared'
import { generateOpaqueToken, hashToken } from '@/lib/oauth/tokens'
import { logEvent } from '@/lib/observability'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { NuphosUserDoc } from '@/lib/identity/shared'

/**
 * Optional two-factor authentication: a TOTP authenticator (RFC 6238) plus
 * single-use recovery codes for when it is lost. Once enabled, a sign-in ends
 * in a challenge rather than a session (`start-session.ts`), and the session
 * is issued only after `verifyMfaChallenge`.
 *
 * Every code check, wherever it comes from, goes through `verifySecondFactor`,
 * so one failure budget per account covers sign-in and settings alike.
 */
export type UserMfa = {
  totp: EncryptedSecret
  enabledAt: Date
  /** The last TOTP time step accepted; a code is never accepted twice. */
  lastStep: number
  /** hashToken of each unused recovery code. */
  recoveryCodes: string[]
}

export type UserMfaPending = { totp: EncryptedSecret; createdAt: Date }

const SETUP_TTL_MS = 15 * 60 * 1000
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MAX_FAILURES = 10
const FAILURE_WINDOW_MS = 15 * 60 * 1000

// ── Account state ──

type MfaFields = Pick<NuphosUserDoc, 'email' | 'mfa' | 'mfaPending' | 'mfaFailures'>

async function readMfa(userId: string): Promise<MfaFields | null> {
  return users().findOne(
    { _id: new ObjectId(userId), deletedAt: { $exists: false } },
    { projection: { email: 1, mfa: 1, mfaPending: 1, mfaFailures: 1 } },
  )
}

export async function isMfaEnabled(userId: string): Promise<boolean> {
  return Boolean((await readMfa(userId))?.mfa)
}

export async function mfaStatus(userId: string) {
  const mfa = (await readMfa(userId))?.mfa

  return {
    enabled: Boolean(mfa),
    enabledAt: mfa?.enabledAt.toISOString() ?? null,
    recoveryCodesRemaining: mfa?.recoveryCodes.length ?? 0,
  }
}

/** Starts enrollment: a fresh secret the user adds to their authenticator. */
export async function startTotpSetup(userId: string) {
  const account = await readMfa(userId)

  if (!account) throw new AppError(401, 'unauthorized', 'Account is no longer available')
  if (account.mfa) {
    throw new AppError(409, 'mfa_already_enabled', 'Two-factor authentication is already on')
  }
  const secret = base32Encode(randomBytes(20))

  await users().updateOne(
    { _id: new ObjectId(userId) },
    { $set: { mfaPending: { totp: sealers.mfa.seal(secret), createdAt: new Date() } } },
  )

  return { secret, otpauthUrl: otpauthUrl(account.email, secret) }
}

/** Finishes enrollment with a code from the authenticator; returns the recovery codes. */
export async function confirmTotpSetup(userId: string, code: unknown) {
  const account = await readMfa(userId)

  if (account?.mfa) {
    throw new AppError(409, 'mfa_already_enabled', 'Two-factor authentication is already on')
  }
  const pending = account?.mfaPending

  if (!account || !pending || Date.now() - pending.createdAt.getTime() > SETUP_TTL_MS) {
    throw new AppError(400, 'mfa_setup_expired', 'Start setting up two-factor authentication again')
  }
  guardFailures(userId, account)
  const step = matchTotp(base32Decode(sealers.mfa.open(pending.totp)), cleanCode(code))

  if (step === null) return failCode(userId, account)
  const { codes, hashes } = newRecoveryCodes()
  const mfa: UserMfa = {
    totp: pending.totp,
    enabledAt: new Date(),
    lastStep: step,
    recoveryCodes: hashes,
  }
  const { modifiedCount } = await users().updateOne(
    { _id: new ObjectId(userId), mfa: { $exists: false } },
    { $set: { mfa }, $unset: { mfaPending: '', mfaFailures: '' } },
  )

  if (!modifiedCount) {
    throw new AppError(409, 'mfa_already_enabled', 'Two-factor authentication is already on')
  }
  void notify(
    account.email,
    'Two-factor authentication turned on',
    'Two-factor authentication was turned on for your Nuphos account.',
  )

  return { recoveryCodes: codes }
}

export async function disableMfa(userId: string, code: unknown): Promise<void> {
  const email = await verifySecondFactor(userId, code)

  await users().updateOne({ _id: new ObjectId(userId) }, { $unset: { mfa: '', mfaPending: '' } })
  void notify(
    email,
    'Two-factor authentication turned off',
    'Two-factor authentication was turned off for your Nuphos account.',
  )
}

export async function regenerateRecoveryCodes(userId: string, code: unknown) {
  await verifySecondFactor(userId, code)
  const { codes, hashes } = newRecoveryCodes()

  await users().updateOne(
    { _id: new ObjectId(userId), mfa: { $exists: true } },
    { $set: { 'mfa.recoveryCodes': hashes } },
  )

  return { recoveryCodes: codes }
}

const cleanCode = (code: unknown) => (typeof code === 'string' ? code.replace(/\s/g, '') : '')

/**
 * Accepts a current authenticator code or an unused recovery code, consuming
 * either so it cannot be replayed. Returns the account's email.
 */
export async function verifySecondFactor(userId: string, code: unknown): Promise<string> {
  const account = await readMfa(userId)
  const mfa = account?.mfa

  if (!account || !mfa) {
    throw new AppError(400, 'mfa_not_enabled', 'Two-factor authentication is not on')
  }
  guardFailures(userId, account)
  const entered = cleanCode(code)
  const _id = new ObjectId(userId)

  if (/^\d{6}$/.test(entered)) {
    const step = matchTotp(base32Decode(sealers.mfa.open(mfa.totp)), entered)
    // Conditional on lastStep, so two requests racing with one code cannot both pass.
    const accepted =
      step !== null &&
      step > mfa.lastStep &&
      (
        await users().updateOne(
          { _id, 'mfa.lastStep': { $lt: step } },
          { $set: { 'mfa.lastStep': step }, $unset: { mfaFailures: '' } },
        )
      ).modifiedCount === 1

    if (accepted) return account.email
  } else if (entered) {
    const hash = hashToken(normalizeRecoveryCode(entered))
    const { modifiedCount } = await users().updateOne(
      { _id, 'mfa.recoveryCodes': hash },
      { $pull: { 'mfa.recoveryCodes': hash }, $unset: { mfaFailures: '' } },
    )

    if (modifiedCount === 1) {
      void notify(
        account.email,
        'A recovery code was used',
        `A recovery code was used to verify your Nuphos account. ${String(mfa.recoveryCodes.length - 1)} remain.`,
      )

      return account.email
    }
  }

  return failCode(userId, account)
}

function guardFailures(userId: string, account: MfaFields): void {
  const failures = account.mfaFailures

  if (
    failures &&
    failures.count >= MAX_FAILURES &&
    Date.now() - failures.since.getTime() < FAILURE_WINDOW_MS
  ) {
    logEvent('warn', 'auth.mfa.locked', { user_id: userId })
    throw new AppError(
      429,
      'mfa_too_many_attempts',
      'Too many wrong codes. Try again in 15 minutes.',
    )
  }
}

async function failCode(userId: string, account: MfaFields): Promise<never> {
  const failures = account.mfaFailures
  const fresh = !failures || Date.now() - failures.since.getTime() >= FAILURE_WINDOW_MS

  await users().updateOne(
    { _id: new ObjectId(userId) },
    fresh
      ? { $set: { mfaFailures: { count: 1, since: new Date() } } }
      : { $inc: { 'mfaFailures.count': 1 } },
  )
  throw new AppError(401, 'invalid_mfa_code', 'That code is not valid')
}

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

/** Best effort, like the sign-in alert: a failed email never fails the change. */
async function notify(to: string, subject: string, line: string): Promise<void> {
  if (!isEmailConfigured()) return
  const notYou =
    "Not you? Open Nuphos, go to Settings → Account → Signed-in devices and sign out the devices you don't recognise, then reset your password from the sign-in screen."

  try {
    await sendEmail({
      to,
      subject,
      text: `${line}\n\n${notYou}`,
      html: `<p>${escapeHtml(line)}</p><p style="color:#55555e">${escapeHtml(notYou)}</p>`,
    })
  } catch (err) {
    logEvent('warn', 'auth.mfa.notify_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
