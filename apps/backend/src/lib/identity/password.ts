import { createHash } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'
import { verifyEmailOtp } from '@/lib/email-otp'
import { AppError } from '@/lib/errors'
import { mapUser, users } from '@/lib/identity/shared'
import { signNuphosToken } from '@/lib/identity/token'

const attempts = () =>
  db().collection<{ _id: string; count: number; expiresAt: Date }>('password_login_attempts')
const WINDOW_MS = 15 * 60 * 1000
let activePasswordWork = 0

// Bound Argon2 memory/CPU even when an attacker rotates email addresses.
async function passwordWork<T>(work: () => Promise<T>): Promise<T> {
  if (activePasswordWork >= 4)
    throw new AppError(429, 'login_busy', 'Sign-in is busy. Please try again shortly')
  activePasswordWork++
  try {
    return await work()
  } finally {
    activePasswordWork--
  }
}

export async function setupPasswordIndexes() {
  await attempts().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

function credentials(input: unknown) {
  const body = input as { email?: unknown; password?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || email.length > 254 || password.length < 12 || password.length > 128) {
    throw new AppError(
      400,
      'invalid_credentials',
      'Enter an email and a password of 12 to 128 characters',
    )
  }

  return { email, password }
}

async function admit(email: string) {
  const bucket = Math.floor(Date.now() / WINDOW_MS)
  const key = createHash('sha256')
    .update(`${email}:${String(bucket)}`)
    .digest('hex')
  const result = await attempts().findOneAndUpdate(
    { _id: key },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * WINDOW_MS) } },
    { upsert: true, returnDocument: 'after' },
  )

  if (!result || result.count > 10) {
    throw new AppError(
      429,
      'login_rate_limited',
      'Too many attempts. Try again in 15 minutes or use an email code',
    )
  }
}

export async function signInWithPassword(input: unknown) {
  const { email, password } = credentials(input)

  await admit(email)
  const user = await users().findOne({ email, deletedAt: { $exists: false } })
  // Verify an equivalent hash even for an unknown email. No account-enumeration
  // distinction in either the response or password hashing work.
  const hash = user?.passwordHash ?? (await dummyHash)
  const valid = await passwordWork(() => Bun.password.verify(password, hash))

  if (!user?.passwordHash || !valid) {
    throw new AppError(401, 'invalid_credentials', 'Incorrect email or password')
  }

  return { token: signNuphosToken(user._id), user: mapUser(user) }
}

const dummyHash = Bun.password.hash('not-a-real-account-password-32', { algorithm: 'argon2id' })

/** Anyone can set/reset their password, but only after proving email ownership. */
export async function setPasswordWithEmailCode(input: unknown) {
  const { email, password } = credentials(input)
  const code = (input as { code?: unknown }).code

  if (typeof code !== 'string')
    throw new AppError(400, 'invalid_code', 'Enter the email verification code')
  const signedIn = await verifyEmailOtp(email, code)
  const passwordHash = await passwordWork(() =>
    Bun.password.hash(password, { algorithm: 'argon2id' }),
  )
  const result = await users().updateOne(
    { _id: new ObjectId(signedIn.user.id), deletedAt: { $exists: false } },
    {
      $set: {
        passwordHash,
        sessionsInvalidBefore: Math.floor(Date.now() / 1000),
        updatedAt: new Date(),
      },
    },
  )

  if (!result.matchedCount)
    throw new AppError(401, 'unauthorized', 'Account is no longer available')

  return { user: signedIn.user, token: signNuphosToken(signedIn.user.id) }
}
