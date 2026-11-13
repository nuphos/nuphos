import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useEmailOtp } from '@/lib/test/doubles/email-otp'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useIdentitySessions } from '@/lib/test/doubles/identity-sessions'
import { FakeCollection } from '@/lib/test/fake-mfa-collection'

import type * as dbActual from '@/lib/db'
import type * as identityActual from '@/lib/identity'

// Run with: cd apps/backend && bun test src/lib/identity/mfa.test.ts

process.env.LINODE_BYOK_ENCRYPTION_KEY = 'a'.repeat(64)

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
const SESSION_ID = '64b7f0c2a1b2c3d4e5f60718'

useIdentity({
  authenticateToken: (async (token: string) =>
    token === 'session-token'
      ? { user: USER, cacheHit: false, provider: 'nuphos' as const, sessionId: SESSION_ID }
      : null) as unknown as typeof identityActual.authenticateToken,
  getNuphosUserById: async (id: string) => (id === USER_ID ? USER : null),
  signInWithGoogleCode: (async () => USER) as unknown as typeof identityActual.signInWithGoogleCode,
})
const revoked: string[] = []
const sources: unknown[] = []

useIdentitySessions({
  revokeAllUserSessions: async (userId: string) => {
    revoked.push(userId)
  },
  createUserSession: async (userId: string, source?: unknown) => {
    sessionsStarted.push(userId)
    sources.push(source)

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

const post = (path: string, body: unknown, token?: string) =>
  app().request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
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
  revoked.length = 0
  sources.length = 0
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

describe('support reset', () => {
  test('turns MFA off and signs the account out everywhere, CLI tokens included', async () => {
    await enroll()
    collection('cli_tokens').docs.push({ _id: new ObjectId(), userId: USER_ID })
    revoked.length = 0

    expect(await mfa.resetMfaForSupport(USER_ID)).toBe(true)
    expect(await mfa.isMfaEnabled(USER_ID)).toBe(false)
    expect(revoked).toEqual([USER_ID])
    expect(collection('cli_tokens').docs).toEqual([])
    expect(account().sessionsInvalidBefore).toBeNumber()
  })

  test('an account without MFA is left alone', async () => {
    expect(await mfa.resetMfaForSupport(USER_ID)).toBe(false)
    expect(revoked).toEqual([])
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

  test('nuphos.ai gets the challenge, and the session is recorded as the website’s', async () => {
    const { secret } = await enroll()
    const res = await post('/auth/google/sign-in', {
      code: 'google-code',
      redirectUri: 'https://nuphos.ai/api/google/callback',
    })
    const [error] = (
      (await res.json()) as {
        errors: { extensions: { code: string; details: { mfaToken: string } } }[]
      }
    ).errors

    expect(error!.extensions.code).toBe('mfa_required')
    const verify = await app().request('/auth/mfa/verify', {
      method: 'POST',
      // The website's own server answers, so its address is not the visitor's.
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify({
        mfaToken: error!.extensions.details.mfaToken,
        code: codeAt(secret, step(1)),
      }),
    })

    expect(verify.status).toBe(200)
    expect(sessionsStarted).toEqual([USER_ID])
    expect(sources[0]).not.toHaveProperty('ip')
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

describe('step-up', () => {
  const MINUTE = 60_000
  const session = () => collection('user_sessions').docs[0]!
  const signedIn = (minutesAgo: number) => {
    collection('user_sessions').docs.push({
      _id: new ObjectId(SESSION_ID),
      userId: USER_ID,
      createdAt: new Date(Date.now() - minutesAgo * MINUTE),
    })
  }
  const errorOf = async (res: Response) =>
    ((await res.json()) as { error: { code: string; details?: unknown } }).error

  test('turning MFA on needs a recent sign-in, even without MFA', async () => {
    signedIn(30)
    const stale = await post('/auth/mfa/totp/setup', {}, 'session-token')

    expect(stale.status).toBe(403)
    expect(await errorOf(stale)).toMatchObject({
      code: 'reauth_required',
      details: { method: 'sign_in' },
    })

    session().createdAt = new Date(Date.now() - 2 * MINUTE)
    expect((await post('/auth/mfa/totp/setup', {}, 'session-token')).status).toBe(200)
  })

  test('without MFA, other checks pass however old the sign-in', async () => {
    signedIn(60 * 24)
    const { requireRecentVerification } = await import('@/lib/identity/step-up')

    await expect(requireRecentVerification(USER_ID, SESSION_ID)).resolves.toBeUndefined()
  })

  test('with MFA, an old session must enter a code, which renews it', async () => {
    const { secret } = await enroll()
    const { requireRecentVerification } = await import('@/lib/identity/step-up')

    signedIn(30)
    await expect(requireRecentVerification(USER_ID, SESSION_ID)).rejects.toMatchObject({
      code: 'reauth_required',
      details: { method: 'mfa' },
    })

    const wrong = await post('/auth/mfa/reauth', { code: 'nope' }, 'session-token')

    expect(wrong.status).toBe(401)
    expect(session().verifiedAt).toBeUndefined()

    const res = await post('/auth/mfa/reauth', { code: codeAt(secret, step(1)) }, 'session-token')

    expect(res.status).toBe(204)
    expect(session().verifiedAt).toBeInstanceOf(Date)
    await expect(requireRecentVerification(USER_ID, SESSION_ID)).resolves.toBeUndefined()
  })
})
