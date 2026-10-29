import { afterEach, describe, expect, test } from 'bun:test'

import { MongoServerError } from 'mongodb'

import { config } from '@/config'
import { useDb } from '@/lib/test/doubles/db'
import { useDownloadHandoffRateLimit } from '@/lib/test/doubles/download-handoff-rate-limit'
import { useEmail } from '@/lib/test/doubles/email'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useObservability } from '@/lib/test/doubles/observability'

type Doc = Record<string, unknown>

const otps = new Map<string, Doc>()
const sentMail: { html: string; text: string }[] = []
let emailConfigured = false

useEmail({
  isEmailConfigured: () => emailConfigured,
  sendEmail: async (input) => {
    sentMail.push(input)
  },
})
let cooldownActive = false

function duplicateKeyError() {
  return new MongoServerError({ code: 11000, errmsg: 'duplicate key' })
}
const collection = {
  updateOne(filter: { email: string }, update: { $set: Doc }) {
    if (cooldownActive) return Promise.reject(duplicateKeyError())
    otps.set(filter.email, { email: filter.email, ...update.$set })

    return Promise.resolve()
  },
  findOneAndUpdate(filter: { email: string }) {
    const doc = otps.get(filter.email)

    if (doc) doc.attempts = Number(doc.attempts) + 1

    return Promise.resolve(doc ?? null)
  },
  findOneAndDelete(filter: {
    email: string
    codeHash: string
    attempts: { $lte: number }
    expiresAt: { $gt: Date }
  }) {
    const doc = otps.get(filter.email)

    if (
      !doc ||
      doc.codeHash !== filter.codeHash ||
      Number(doc.attempts) > filter.attempts.$lte ||
      (doc.expiresAt as Date) <= filter.expiresAt.$gt
    )
      return Promise.resolve(null)
    otps.delete(filter.email)

    return Promise.resolve(doc)
  },
  deleteOne(filter: { email: string }) {
    otps.delete(filter.email)

    return Promise.resolve()
  },
}
const logged: { event: string; properties?: Doc }[] = []

useDb({ db: () => ({ collection: () => collection }) })
useIdentity({
  signInWithVerifiedEmail: (email: string) => Promise.resolve({ email }),
})
useObservability({
  logEvent: (_level, event, properties) => {
    logged.push({ event, properties })
  },
})

let quota: 'allowed' | 'limited' | 'unavailable' = 'unavailable'
const quotaKeys: string[] = []

useDownloadHandoffRateLimit({
  consumePairQuota: (first, second) => {
    quotaKeys.push(first.key, second.key)

    return Promise.resolve(quota)
  },
})

const { requestEmailOtp, verifyEmailOtp } = await import('@/lib/email-otp')

afterEach(() => {
  quota = 'unavailable'
  quotaKeys.length = 0
  config.email.devLogOtp = false
  otps.clear()
  logged.length = 0
})

describe('email OTP dev log', () => {
  test('without delivery configured, sign-in stays unavailable by default', async () => {
    await expect(requestEmailOtp('dev@example.com')).rejects.toMatchObject({
      code: 'email_not_configured',
    })
  })

  test('logs the code instead of sending it, and the logged code signs in', async () => {
    config.email.devLogOtp = true

    await requestEmailOtp('Dev@Example.com')
    const entry = logged.find((line) => line.event === 'auth.email_otp.dev_code')

    expect(entry?.properties?.email).toBe('dev@example.com')
    const code = String(entry?.properties?.sign_in_code)

    expect(code).toMatch(/^\d{6}$/)
    expect(await verifyEmailOtp('dev@example.com', code)).toMatchObject({
      email: 'dev@example.com',
    })
  })
})

test('a valid code cannot be redeemed concurrently twice', async () => {
  config.email.devLogOtp = true
  await requestEmailOtp('once@example.com')
  const code = String(
    logged.find((line) => line.event === 'auth.email_otp.dev_code')?.properties?.sign_in_code,
  )
  const results = await Promise.allSettled([
    verifyEmailOtp('once@example.com', code),
    verifyEmailOtp('once@example.com', code),
  ])

  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
})

describe('email OTP abuse limits', () => {
  test('a request the cooldown rejects does not spend the quota', async () => {
    config.email.devLogOtp = true
    cooldownActive = true

    await expect(requestEmailOtp('busy@example.com')).rejects.toMatchObject({
      code: 'otp_cooldown',
    })
    cooldownActive = false
    expect(quotaKeys).toHaveLength(0)
  })

  test('refuses to send once the per-email or per-IP quota is spent', async () => {
    config.email.devLogOtp = true
    quota = 'limited'

    await expect(requestEmailOtp('cap@example.com', '203.0.113.7')).rejects.toMatchObject({
      code: 'otp_cooldown',
    })
    // The stored code is dropped because it was never sent.
    expect(otps.has('cap@example.com')).toBe(false)
    expect(logged.some((line) => line.event === 'auth.email_otp.dev_code')).toBe(false)
    // Keys are hashed so Redis never holds raw emails or IPs.
    expect(quotaKeys.join(' ')).not.toContain('cap@example.com')
    expect(quotaKeys.join(' ')).not.toContain('203.0.113.7')
  })

  test('a locked-out code stays locked instead of being deleted', async () => {
    config.email.devLogOtp = true
    await requestEmailOtp('lock@example.com')
    const code = String(
      logged.find((line) => line.event === 'auth.email_otp.dev_code')?.properties?.sign_in_code,
    )
    const wrong = code === '000000' ? '111111' : '000000'

    for (let i = 0; i < 5; i++) {
      await expect(verifyEmailOtp('lock@example.com', wrong)).rejects.toMatchObject({
        code: 'otp_invalid',
      })
    }
    await expect(verifyEmailOtp('lock@example.com', code)).rejects.toMatchObject({
      code: 'otp_too_many_attempts',
    })
    // The doc (and with it the resend cooldown) survives the lockout.
    expect(otps.has('lock@example.com')).toBe(true)
  })
})

test('the code email says where the request came from', async () => {
  const devLog = config.email.devLogOtp

  config.email.devLogOtp = false
  emailConfigured = true
  try {
    await requestEmailOtp('where@example.com', '203.0.113.9', {
      ip: '203.0.113.9',
      city: 'Taipei',
      country: 'TW',
      client: 'nuphos-ios/2.1.0',
    })
  } finally {
    config.email.devLogOtp = devLog
    emailConfigured = false
  }
  const mail = sentMail.at(-1)!

  expect(mail.text).toContain(
    'Requested from IP 203.0.113.9 (approximately Taipei, TW) on Nuphos for iOS.',
  )
  expect(mail.html).toContain('Taipei, TW')
})

test('a code email never repeats the request headers', async () => {
  const devLog = config.email.devLogOtp
  const lure = 'Nuphos Security: reply with this code'

  config.email.devLogOtp = false
  emailConfigured = true
  try {
    await requestEmailOtp('lure@example.com', '203.0.113.9', {
      ip: '203.0.113.9',
      client: lure,
      userAgent: lure,
    })
  } finally {
    config.email.devLogOtp = devLog
    emailConfigured = false
  }
  const mail = sentMail.at(-1)!

  expect(mail.text).not.toContain(lure)
  expect(mail.html).not.toContain(lure)
  expect(mail.text).toContain('on Unknown device.')
})

test('a code email never repeats a version an app name carries', async () => {
  const devLog = config.email.devLogOtp
  const phish = 'nuphos-desktop/1.verify-at.evil-phish.com'

  config.email.devLogOtp = false
  emailConfigured = true
  try {
    await requestEmailOtp('phish@example.com', '203.0.113.9', { ip: '203.0.113.9', client: phish })
  } finally {
    config.email.devLogOtp = devLog
    emailConfigured = false
  }
  const mail = sentMail.at(-1)!

  expect(mail.text).not.toContain('evil-phish')
  expect(mail.html).not.toContain('evil-phish')
  expect(mail.text).toContain('on Nuphos Desktop.')
})
