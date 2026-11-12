import { randomBytes } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { sealers } from '@/lib/byos/secrets'
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
import { hashToken } from '@/lib/oauth/tokens'
import { logEvent } from '@/lib/observability'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { NuphosUserDoc } from '@/lib/identity/shared'

/**
 * Optional two-factor authentication: a TOTP authenticator (RFC 6238) plus
 * single-use recovery codes for when it is lost. Once enabled, a sign-in ends
 * in a challenge rather than a session (`start-session.ts`), and the session
 * is issued only after `verifyMfaChallenge` (`mfa-challenge.ts`).
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
  await reserveAttempt(userId)
  const step = matchTotp(base32Decode(sealers.mfa.open(pending.totp)), cleanCode(code))

  if (step === null) throw invalidCode()
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
  await reserveAttempt(userId)
  const entered = cleanCode(code)
  const _id = new ObjectId(userId)

  if (/^\d{6}$/.test(entered)) {
    // A code for the next step (clock drift) moves lastStep past the current
    // one, so the current step's code is then refused until the step after.
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

  throw invalidCode()
}

const invalidCode = () => new AppError(401, 'invalid_mfa_code', 'That code is not valid')

/**
 * Counts an attempt before its code is checked, so a burst of parallel guesses
 * cannot all read the counter before any of them writes it. A right code then
 * clears the count. Each step is one atomic update: add to a window still open,
 * or start a new one when it has lapsed (retried if another request did first).
 */
async function reserveAttempt(userId: string): Promise<void> {
  const _id = new ObjectId(userId)

  for (let tries = 0; tries < 3; tries++) {
    const windowStart = new Date(Date.now() - FAILURE_WINDOW_MS)
    const counted = await users().findOneAndUpdate(
      { _id, 'mfaFailures.since': { $gt: windowStart } },
      { $inc: { 'mfaFailures.count': 1 } },
      { returnDocument: 'after', projection: { mfaFailures: 1 } },
    )

    if (counted) {
      if ((counted.mfaFailures?.count ?? 0) <= MAX_FAILURES) return
      logEvent('warn', 'auth.mfa.locked', { user_id: userId })
      throw new AppError(
        429,
        'mfa_too_many_attempts',
        'Too many wrong codes. Try again in 15 minutes.',
      )
    }
    const opened = await users().updateOne(
      {
        _id,
        $or: [{ mfaFailures: { $exists: false } }, { 'mfaFailures.since': { $lte: windowStart } }],
      },
      { $set: { mfaFailures: { count: 1, since: new Date() } } },
    )

    if (opened.modifiedCount === 1) return
  }
  throw new AppError(429, 'mfa_too_many_attempts', 'Too many attempts. Try again shortly.')
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
