import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useEmailOtp } from '@/lib/test/doubles/email-otp'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useIdentitySessions } from '@/lib/test/doubles/identity-sessions'

import type * as dbActual from '@/lib/db'
import type * as identityActual from '@/lib/identity'

// Run with: cd apps/backend && bun test src/lib/identity/mfa.test.ts

process.env.LINODE_BYOK_ENCRYPTION_KEY = 'a'.repeat(64)

type Doc = Record<string, unknown>

const get = (doc: Doc, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v as Doc | undefined)?.[k], doc)

function set(doc: Doc, path: string, value: unknown) {
  const keys = path.split('.')
  const last = keys.pop()!
  let parent = doc

  for (const key of keys) {
    parent[key] ??= {}
    parent = parent[key] as Doc
  }

  if (value === undefined) delete parent[last]
  else parent[last] = value
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([path, expected]) => {
    if (path === '$or') return (expected as Doc[]).some((f) => matches(doc, f))
    const value = get(doc, path)

    if (expected instanceof ObjectId) return String(value) === expected.toHexString()
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const op = expected as Doc

      if ('$exists' in op) return (value !== undefined) === op.$exists
      if ('$lt' in op) return (value as number) < (op.$lt as number)
      if ('$lte' in op) return value instanceof Date && value <= (op.$lte as Date)
      if ('$gt' in op) return value instanceof Date && value > (op.$gt as Date)
    }
    if (Array.isArray(value)) return value.includes(expected)

    return value === expected
  })
}

/** Just the Mongo the MFA code uses. */
class FakeCollection {
  docs: Doc[] = []
  async insertOne(doc: Doc) {
    this.docs.push(structuredClone(doc))

    return { insertedId: doc._id }
  }
  async findOne(filter: Doc) {
    const hit = this.docs.find((d) => matches(d, filter))

    return hit ? structuredClone(hit) : null
  }
  async findOneAndDelete(filter: Doc) {
    const hit = this.docs.find((d) => matches(d, filter))

    this.docs = this.docs.filter((d) => d !== hit)

    return hit ?? null
  }
  async findOneAndUpdate(filter: Doc, update: Record<string, Doc>) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (hit) await this.updateOne({ _id: hit._id }, update)

    return hit ? structuredClone(hit) : null
  }
  async updateOne(filter: Doc, update: Record<string, Doc>) {
    // Yield first, as a round trip would, so parallel requests interleave.
    await Promise.resolve()
    const hit = this.docs.find((d) => matches(d, filter))

    if (!hit) return { matchedCount: 0, modifiedCount: 0 }
    for (const [path, value] of Object.entries(update.$set ?? {})) set(hit, path, value)
    for (const path of Object.keys(update.$unset ?? {})) set(hit, path, undefined)
    for (const [path, by] of Object.entries(update.$inc ?? {})) {
      set(hit, path, (get(hit, path) as number) + (by as number))
    }
    for (const [path, value] of Object.entries(update.$pull ?? {})) {
      set(
        hit,
        path,
        (get(hit, path) as unknown[]).filter((v) => v !== value),
      )
    }

    return { matchedCount: 1, modifiedCount: 1 }
  }
  find() {
    const cursor = { limit: () => cursor, toArray: async () => [] }

    return cursor
  }
}

const collections = new Map<string, FakeCollection>()
const collection = (name: string) => {
  if (!collections.has(name)) collections.set(name, new FakeCollection())

  return collections.get(name)!
}

const USER_ID = '507f1f77bcf86cd799439011'
const USER = {
  id: USER_ID,
  email: 'bruce@example.com',
  name: 'Bruce',
  username: 'bruce',
  avatarURL: '',
  language: 'en-US',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const sessionsStarted: string[] = []

useDb({ db: () => ({ collection }) })
useIdentity({
  getNuphosUserById: async (id: string) => (id === USER_ID ? USER : null),
})
useIdentitySessions({
  createUserSession: async (userId: string) => {
    sessionsStarted.push(userId)

    return `session-for-${userId}`
  },
})
useEmailOtp({ verifyEmailOtp: async () => USER })

const mfa = await import('@/lib/identity/mfa')
const { base32Decode, base32Encode, totpCode } = await import('@/lib/identity/mfa-codes')
const { auth } = await import('@/routes/auth')

const users = () => collection('users')
const account = () => users().docs[0]!

function app() {
  const outer = new Hono()

  outer.onError(errorHandler)
  outer.route('/auth', auth)

  return outer
}

const post = (path: string, body: unknown) =>
  app().request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const step = (offset = 0) => Math.floor(Date.now() / 30_000) + offset
const codeAt = (secret: string, s: number) => totpCode(base32Decode(secret), s)

/** Turns MFA on the way a user would; returns the secret and recovery codes. */
async function enroll() {
  const { secret } = await mfa.startTotpSetup(USER_ID)
  const { recoveryCodes } = await mfa.confirmTotpSetup(USER_ID, codeAt(secret, step()))

  return { secret, recoveryCodes }
}

beforeEach(() => {
  collections.clear()
  sessionsStarted.length = 0
  users().docs.push({ _id: new ObjectId(USER_ID), email: USER.email })
})

describe('TOTP', () => {
  // RFC 6238 appendix B, SHA-1, truncated to six digits.
  test.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [20000000000, '353130'],
  ])('matches the RFC vector at T=%d', (t, code) => {
    expect(totpCode(Buffer.from('12345678901234567890'), Math.floor(t / 30))).toBe(code)
  })

  test('base32 round-trips', () => {
    const bytes = Buffer.from('12345678901234567890')

    expect(base32Encode(bytes)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes)
  })
})

describe('enrollment', () => {
  test('stores the secret sealed and returns ten recovery codes', async () => {
    const { secret, recoveryCodes } = await enroll()

    expect(recoveryCodes).toHaveLength(10)
    expect(JSON.stringify(account())).not.toContain(secret)
    expect(account().mfaPending).toBeUndefined()
    expect(await mfa.mfaStatus(USER_ID)).toMatchObject({
      enabled: true,
      recoveryCodesRemaining: 10,
    })
  })

  test('a wrong code does not turn it on', async () => {
    const { secret } = await mfa.startTotpSetup(USER_ID)
    const wrong = codeAt(secret, step()) === '000000' ? '111111' : '000000'

    await expect(mfa.confirmTotpSetup(USER_ID, wrong)).rejects.toMatchObject({
      code: 'invalid_mfa_code',
    })
    expect(await mfa.isMfaEnabled(USER_ID)).toBe(false)
  })

  test('cannot start again while on', async () => {
    await enroll()
    await expect(mfa.startTotpSetup(USER_ID)).rejects.toMatchObject({ code: 'mfa_already_enabled' })
  })
})

describe('verifySecondFactor', () => {
  test('a code is accepted once, not again', async () => {
    const { secret } = await enroll()
    const code = codeAt(secret, step(1))

    await mfa.verifySecondFactor(USER_ID, code)
    await expect(mfa.verifySecondFactor(USER_ID, code)).rejects.toMatchObject({
      code: 'invalid_mfa_code',
    })
  })

  test('the enrollment code itself cannot be replayed', async () => {
    const { secret } = await enroll()

    await expect(mfa.verifySecondFactor(USER_ID, codeAt(secret, step()))).rejects.toMatchObject({
      code: 'invalid_mfa_code',
    })
  })

  test('a recovery code works once, in any case or spacing', async () => {
    const { recoveryCodes } = await enroll()
    const code = recoveryCodes[0]!

    await mfa.verifySecondFactor(USER_ID, ` ${code.toUpperCase()} `)
    await expect(mfa.verifySecondFactor(USER_ID, code)).rejects.toMatchObject({
      code: 'invalid_mfa_code',
    })
    expect((await mfa.mfaStatus(USER_ID)).recoveryCodesRemaining).toBe(9)
  })

  test('ten wrong codes lock the account for a while, even with the right code', async () => {
    const { secret } = await enroll()

    for (let i = 0; i < 10; i++) {
      await mfa.verifySecondFactor(USER_ID, 'wrong-code').catch(() => {})
    }
    await expect(mfa.verifySecondFactor(USER_ID, codeAt(secret, step(1)))).rejects.toMatchObject({
      code: 'mfa_too_many_attempts',
    })
  })

  test('parallel guesses cannot get past the limit', async () => {
    await enroll()
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => mfa.verifySecondFactor(USER_ID, '000000')),
    )
    const codes = results.map((r) =>
      r.status === 'rejected' ? (r.reason as { code: string }).code : 'ok',
    )

    expect(codes.filter((c) => c === 'mfa_too_many_attempts').length).toBeGreaterThanOrEqual(40)
    expect(account().mfaFailures).toMatchObject({ count: 50 })
  })

  test('turning it off takes a code', async () => {
    const { secret } = await enroll()

    await expect(mfa.disableMfa(USER_ID, '')).rejects.toMatchObject({ code: 'invalid_mfa_code' })
    await mfa.disableMfa(USER_ID, codeAt(secret, step(1)))
    expect(await mfa.isMfaEnabled(USER_ID)).toBe(false)
  })

  test('new recovery codes replace the old ones', async () => {
    const { secret, recoveryCodes } = await enroll()
    const fresh = await mfa.regenerateRecoveryCodes(USER_ID, codeAt(secret, step(1)))

    expect(fresh.recoveryCodes).not.toContain(recoveryCodes[0])
    await expect(mfa.verifySecondFactor(USER_ID, recoveryCodes[0])).rejects.toMatchObject({
      code: 'invalid_mfa_code',
    })
  })
})

describe('sign-in', () => {
  const signIn = () => post('/auth/email/verify-code', { email: USER.email, code: '123456' })

  test('without MFA, a sign-in starts a session as before', async () => {
    const res = await signIn()

    expect(res.status).toBe(200)
    expect(sessionsStarted).toEqual([USER_ID])
  })

  test('with MFA, a sign-in returns a challenge and no session', async () => {
    await enroll()
    const res = await signIn()
    const body = (await res.json()) as { error: { code: string; details: { mfaToken: string } } }

    expect(res.status).toBe(401)
    expect(body.error.code).toBe('mfa_required')
    expect(body.error.details.mfaToken).toBeString()
    expect(JSON.stringify(body)).not.toContain('session-for')
    expect(sessionsStarted).toEqual([])
  })

  test('the challenge and a code start the session, once', async () => {
    const { secret } = await enroll()
    const { mfaToken } = (
      (await (await signIn()).json()) as { error: { details: { mfaToken: string } } }
    ).error.details
    const res = await post('/auth/mfa/verify', { mfaToken, code: codeAt(secret, step(1)) })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      token: `session-for-${USER_ID}`,
      user: { id: USER_ID },
    })

    const again = await post('/auth/mfa/verify', { mfaToken, code: codeAt(secret, step(-1)) })

    expect(again.status).toBe(401)
    expect(sessionsStarted).toEqual([USER_ID])
  })

  test('a wrong code or an unknown challenge starts nothing', async () => {
    await enroll()
    const { mfaToken } = (
      (await (await signIn()).json()) as { error: { details: { mfaToken: string } } }
    ).error.details

    expect((await post('/auth/mfa/verify', { mfaToken, code: '12' })).status).toBe(401)
    expect((await post('/auth/mfa/verify', { mfaToken: 'nope', code: '123456' })).status).toBe(401)
    expect(sessionsStarted).toEqual([])
  })
})
