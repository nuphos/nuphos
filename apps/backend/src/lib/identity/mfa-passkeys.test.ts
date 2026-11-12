import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useEmailOtp } from '@/lib/test/doubles/email-otp'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useIdentitySessions } from '@/lib/test/doubles/identity-sessions'
import { useWebAuthn } from '@/lib/test/doubles/webauthn'
import { FakeCollection } from '@/lib/test/fake-mfa-collection'

import type * as dbActual from '@/lib/db'
import type * as identityActual from '@/lib/identity'

// Run with: cd apps/backend && bun test src/lib/identity/mfa-passkeys.test.ts
//
// The WebAuthn cryptography is @simplewebauthn/server's and is stubbed here: a
// "signed" answer is one that names the challenge it was given. What is under
// test is ours: which challenge each answer must match, where it is kept, and
// what a passkey may and may not do.

process.env.LINODE_BYOK_ENCRYPTION_KEY = 'a'.repeat(64)

let issued = 0

useWebAuthn({
  generateRegistrationOptions: async () => ({ challenge: 'registration' }),
  verifyRegistrationResponse: async (o: {
    response: { id: string; signed: string }
    expectedChallenge: string
  }) =>
    o.response.signed === o.expectedChallenge
      ? {
          verified: true,
          registrationInfo: {
            credential: {
              id: o.response.id,
              publicKey: new Uint8Array([1, 2, 3]),
              counter: 0,
              transports: ['internal'],
            },
          },
        }
      : { verified: false },
  generateAuthenticationOptions: async () => {
    issued += 1

    return { challenge: `assertion-${String(issued)}` }
  },
  verifyAuthenticationResponse: async (o: {
    response: { signed: string }
    expectedChallenge: string
    credential: { counter: number }
  }) =>
    o.response.signed === o.expectedChallenge
      ? { verified: true, authenticationInfo: { newCounter: o.credential.counter + 1 } }
      : { verified: false },
} as unknown as Parameters<typeof useWebAuthn>[0])

const collections = new Map<string, FakeCollection>()
const collection = (name: string) => {
  if (!collections.has(name)) collections.set(name, new FakeCollection())

  return collections.get(name)!
}

const USER_ID = '507f1f77bcf86cd799439011'
const SESSION_ID = '64b7f0c2a1b2c3d4e5f60718'
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

useDb({ db: (() => ({ collection })) as unknown as typeof dbActual.db })
useIdentity({
  authenticateToken: (async (token: string) =>
    token === 'session-token'
      ? { user: USER, cacheHit: false, provider: 'nuphos' as const, sessionId: SESSION_ID }
      : null) as unknown as typeof identityActual.authenticateToken,
  getNuphosUserById: (async (id: string) =>
    id === USER_ID ? USER : null) as unknown as typeof identityActual.getNuphosUserById,
})
useIdentitySessions({
  createUserSession: async (userId: string) => {
    sessionsStarted.push(userId)

    return `session-for-${userId}`
  },
})
useEmailOtp({ verifyEmailOtp: async () => USER })

const mfa = await import('@/lib/identity/mfa')
const { base32Decode, totpCode } = await import('@/lib/identity/mfa-codes')
const { auth } = await import('@/routes/auth')

const app = new Hono().onError(errorHandler).route('/auth', auth)
const call = (method: string, path: string, body?: unknown, token = 'session-token') =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const json = async (res: Response) => (await res.json()) as Record<string, any>
const account = () => collection('users').docs[0] as Record<string, any>
const code = (secret: string, offset: number) =>
  totpCode(base32Decode(secret), Math.floor(Date.now() / 30_000) + offset)

async function enroll() {
  const { secret } = await mfa.startTotpSetup(USER_ID)

  await mfa.confirmTotpSetup(USER_ID, code(secret, 0))

  return secret
}

async function addPasskey(id = 'key-1') {
  expect((await call('POST', '/auth/mfa/passkeys/options')).status).toBe(200)

  return call('POST', '/auth/mfa/passkeys', {
    response: { id, signed: 'registration' },
    name: 'MacBook',
  })
}

beforeEach(() => {
  collections.clear()
  sessionsStarted.length = 0
  collection('users').docs.push({ _id: new ObjectId(USER_ID), email: USER.email })
  // Signed in just now, so the session is recently verified.
  collection('user_sessions').docs.push({
    _id: new ObjectId(SESSION_ID),
    userId: USER_ID,
    createdAt: new Date(),
  })
})

describe('adding a passkey', () => {
  test('needs two-factor authentication on first', async () => {
    const res = await call('POST', '/auth/mfa/passkeys/options')

    expect(res.status).toBe(400)
    expect((await json(res)).error.code).toBe('mfa_not_enabled')
  })

  test('stores only its public key, and the challenge is spent', async () => {
    await enroll()
    const res = await addPasskey()

    expect(res.status).toBe(200)
    expect((await json(res)).passkey).toMatchObject({ id: 'key-1', name: 'MacBook' })
    expect(account().mfa.passkeys[0]).toMatchObject({ id: 'key-1', publicKey: 'AQID', counter: 0 })
    expect(account().passkeyChallenge).toBeUndefined()
    expect((await mfa.mfaStatus(USER_ID)).passkeys).toHaveLength(1)
  })

  test('an answer to another challenge adds nothing', async () => {
    await enroll()
    await call('POST', '/auth/mfa/passkeys/options')
    const res = await call('POST', '/auth/mfa/passkeys', {
      response: { id: 'key-1', signed: 'elsewhere' },
    })

    expect(res.status).toBe(400)
    expect(account().mfa.passkeys).toBeUndefined()
  })

  test('needs a recent check, like any new second factor', async () => {
    await enroll()
    collection('user_sessions').docs[0]!.createdAt = new Date(Date.now() - 30 * 60_000)
    const res = await call('POST', '/auth/mfa/passkeys/options')

    expect(res.status).toBe(403)
    expect((await json(res)).error.code).toBe('reauth_required')
  })
})

describe('answering with a passkey', () => {
  test('finishes a sign-in, bound to that sign-in’s challenge', async () => {
    await enroll()
    await addPasskey()
    const { mfaToken } = (
      await json(
        await call('POST', '/auth/email/verify-code', { email: USER.email, code: '123456' }),
      )
    ).error.details
    const options = await json(await call('POST', '/auth/mfa/verify/options', { mfaToken }, ''))
    const wrong = await call(
      'POST',
      '/auth/mfa/verify',
      { mfaToken, passkey: { id: 'key-1', signed: 'assertion-0' } },
      '',
    )

    expect(wrong.status).toBe(401)
    const res = await call(
      'POST',
      '/auth/mfa/verify',
      { mfaToken, passkey: { id: 'key-1', signed: options.challenge } },
      '',
    )

    expect(res.status).toBe(200)
    expect(sessionsStarted).toEqual([USER_ID])
    expect(account().mfa.passkeys[0].counter).toBe(1)
  })

  test('steps a session up', async () => {
    await enroll()
    await addPasskey()
    collection('user_sessions').docs[0]!.createdAt = new Date(Date.now() - 30 * 60_000)
    const options = await json(await call('POST', '/auth/mfa/passkey-options'))
    const res = await call('POST', '/auth/mfa/reauth', {
      passkey: { id: 'key-1', signed: options.challenge },
    })

    expect(res.status).toBe(204)
    expect(collection('user_sessions').docs[0]!.verifiedAt).toBeInstanceOf(Date)
    expect(account().passkeyChallenge).toBeUndefined()
  })

  test('one answer replayed in parallel passes once', async () => {
    await enroll()
    await addPasskey()
    const options = await json(await call('POST', '/auth/mfa/passkey-options'))
    const answer = { passkey: { id: 'key-1', signed: options.challenge } }
    const results = await Promise.all([
      call('POST', '/auth/mfa/reauth', answer),
      call('POST', '/auth/mfa/reauth', answer),
    ])

    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([204, 401])
  })

  test('a sign-in never takes the challenge a session left on the account', async () => {
    await enroll()
    await addPasskey()
    const sessionOptions = await json(await call('POST', '/auth/mfa/passkey-options'))
    const signIn = await json(
      await call('POST', '/auth/email/verify-code', { email: USER.email, code: '123456' }),
    )
    const res = await call(
      'POST',
      '/auth/mfa/verify',
      {
        mfaToken: signIn.error.details.mfaToken,
        passkey: { id: 'key-1', signed: sessionOptions.challenge },
      },
      '',
    )

    expect(res.status).toBe(401)
    expect(sessionsStarted).toEqual([])
  })

  test('an unknown passkey is refused', async () => {
    await enroll()
    await addPasskey()
    const options = await json(await call('POST', '/auth/mfa/passkey-options'))
    const res = await call('POST', '/auth/mfa/reauth', {
      passkey: { id: 'someone-else', signed: options.challenge },
    })

    expect(res.status).toBe(401)
  })
})

describe('removing a passkey', () => {
  test('takes a code, and leaves two-factor authentication on', async () => {
    const secret = await enroll()

    await addPasskey()
    expect((await call('DELETE', '/auth/mfa/passkeys/key-1', { code: 'nope' })).status).toBe(401)
    expect(
      (await call('DELETE', '/auth/mfa/passkeys/key-1', { code: code(secret, 1) })).status,
    ).toBe(204)
    expect(account().mfa.passkeys).toEqual([])
    expect(await mfa.isMfaEnabled(USER_ID)).toBe(true)
  })
})
