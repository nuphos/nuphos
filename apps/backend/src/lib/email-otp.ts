import { createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto'

import { MongoServerError } from 'mongodb'

import type { NuphosUser } from '@/lib/identity'
import type { Collection, ObjectId } from 'mongodb'

import { config } from '@/config'
import { db } from '@/lib/db'
import { isEmailConfigured, sendEmail } from '@/lib/email'
import { AppError } from '@/lib/errors'
import { signInWithVerifiedEmail } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

const CODE_TTL_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_VERIFY_ATTEMPTS = 5

type EmailOtpDoc = {
  _id?: ObjectId
  email: string
  codeHash: string
  attempts: number
  createdAt: Date
  expiresAt: Date
}

const otps = (): Collection<EmailOtpDoc> => db().collection<EmailOtpDoc>('email_otps')

export async function setupEmailOtpIndexes(): Promise<void> {
  await Promise.all([
    otps().createIndex({ email: 1 }, { unique: true, background: true }),
    otps().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'email_otps_ttl' }),
  ])
}

export async function requestEmailOtp(email: string): Promise<void> {
  const normalized = normalizeEmail(email)

  if (!config.email.devLogOtp && !isEmailConfigured()) {
    throw new AppError(503, 'email_not_configured', 'Email sign-in is not available on this server')
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const codeHash = hashCode(normalized, code)
  const now = new Date()
  // Atomic cooldown: the filter only matches docs older than the cooldown, so
  // a fresh doc forces the upsert down the insert path, which the unique email
  // index rejects — concurrent requests can't each trigger a send.
  const cutoff = new Date(now.getTime() - RESEND_COOLDOWN_MS)

  try {
    await otps().updateOne(
      { email: normalized, createdAt: { $lt: cutoff } },
      {
        $set: {
          codeHash,
          attempts: 0,
          createdAt: now,
          expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        },
      },
      { upsert: true },
    )
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      throw new AppError(
        429,
        'otp_cooldown',
        'A code was sent recently — wait a minute before requesting another',
      )
    }
    throw err
  }

  if (config.email.devLogOtp) {
    logEvent('warn', 'auth.email_otp.dev_code', { email: normalized, sign_in_code: code })

    return
  }

  try {
    await sendEmail({
      to: normalized,
      subject: `${code} is your Nuphos sign-in code`,
      html: otpEmailHtml(code),
      text: `Your Nuphos sign-in code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    })
  } catch (err) {
    // Undo the stored code so the cooldown doesn't lock the user out of
    // retrying after a delivery failure.
    await otps()
      .deleteOne({ email: normalized, codeHash })
      .catch(() => {})
    console.error('email-otp: failed to send code', err)
    throw new AppError(502, 'otp_send_failed', 'Failed to send the sign-in code — try again')
  }
}

export async function verifyEmailOtp(
  email: string,
  code: string,
): Promise<{ token: string; user: NuphosUser }> {
  const normalized = normalizeEmail(email)

  if (!/^\d{6}$/.test(code)) {
    throw new AppError(400, 'otp_invalid', 'Incorrect or expired code')
  }

  const doc = await otps().findOneAndUpdate(
    { email: normalized },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  )

  // The TTL reaper is lazy (runs ~every 60s), so expiry must be checked here.
  if (!doc || doc.expiresAt.getTime() <= Date.now()) {
    throw new AppError(400, 'otp_invalid', 'Incorrect or expired code')
  }
  if (doc.attempts > MAX_VERIFY_ATTEMPTS) {
    await otps().deleteOne({ email: normalized })
    throw new AppError(
      429,
      'otp_too_many_attempts',
      'Too many incorrect attempts — request a new code',
    )
  }
  if (!safeEqual(doc.codeHash, hashCode(normalized, code))) {
    throw new AppError(400, 'otp_invalid', 'Incorrect or expired code')
  }

  const consumed = await otps().findOneAndDelete({
    email: normalized,
    codeHash: doc.codeHash,
    attempts: { $lte: MAX_VERIFY_ATTEMPTS },
    expiresAt: { $gt: new Date() },
  })

  if (!consumed) throw new AppError(400, 'otp_invalid', 'Incorrect or expired code')

  return signInWithVerifiedEmail(normalized)
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase()

  if (
    normalized.length < 3 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(normalized)
  ) {
    throw new AppError(400, 'invalid_email', 'Enter a valid email address')
  }

  return normalized
}

// HMAC keyed with a secret so a leaked collection alone can't be brute forced
// offline across the 6-digit code space. The key is HKDF-derived from the JWT
// secret with an OTP-specific context, so the two domains stay separated
// without another env var.
let otpHmacKey: Buffer | null = null

function hashCode(email: string, code: string): string {
  if (!otpHmacKey) {
    const secret = config.auth.jwtSecret

    if (!secret) {
      throw new Error('NUPHOS_JWT_SECRET or JWT_SECRET_KEY is required for email OTP sign-in')
    }
    otpHmacKey = Buffer.from(hkdfSync('sha256', secret, '', 'nuphos-email-otp-v1', 32))
  }

  return createHmac('sha256', otpHmacKey).update(`${email}:${code}`).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)

  return left.length === right.length && timingSafeEqual(left, right)
}

function otpEmailHtml(code: string): string {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:32px 16px;background:#f6f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1e">
  <div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e6e6ea">
    <div style="font-size:16px;font-weight:600;margin-bottom:16px">Sign in to Nuphos</div>
    <div style="font-size:14px;color:#55555e;line-height:1.6;margin-bottom:24px">
      Use this code to finish signing in. It expires in 10 minutes.
    </div>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;background:#f6f6f8;border-radius:8px">${code}</div>
    <div style="font-size:12.5px;color:#8a8a94;line-height:1.6;margin-top:24px">
      If you didn't request this code, you can safely ignore this email.
    </div>
  </div>
</body>
</html>`
}
