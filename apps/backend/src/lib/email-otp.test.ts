import { afterEach, describe, expect, test } from 'bun:test'

import { config } from '@/config'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useObservability } from '@/lib/test/doubles/observability'

type Doc = Record<string, unknown>

const otps = new Map<string, Doc>()
const collection = {
  updateOne(filter: { email: string }, update: { $set: Doc }) {
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
  signInWithVerifiedEmail: (email: string) =>
    Promise.resolve({
      token: `token-for-${email}`,
      user: { email },
    }),
})
useObservability({
  logEvent: (_level, event, properties) => {
    logged.push({ event, properties })
  },
})

const { requestEmailOtp, verifyEmailOtp } = await import('@/lib/email-otp')

afterEach(() => {
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
      token: 'token-for-dev@example.com',
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
