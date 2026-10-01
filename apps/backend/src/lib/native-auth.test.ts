import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type * as dbActual from '@/lib/db'
import type * as identityActual from '@/lib/identity'

// Run with: cd apps/backend && bun test src/lib/native-auth.test.ts
//
// Covers the properties that make the native handoff safe: the delivery target
// comes only from the registration, redemption needs BOTH the PKCE verifier
// (proving who registered) and the delivery code (proving who received the
// loopback redirect), and it works exactly once.

// ── A Mongo stand-in supporting the operators native-auth actually uses. ──
type Doc = Record<string, unknown>

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$gt' in (expected as Doc)) {
      const bound = (expected as { $gt: Date }).$gt
      const value = doc[key]

      return value instanceof Date && value.getTime() > bound.getTime()
    }

    return doc[key] === expected
  })
}

class FakeCollection {
  docs: Doc[] = []

  async insertOne(doc: Doc) {
    this.docs.push({ ...doc })

    return { insertedId: doc._id }
  }
  async findOne(filter: Doc) {
    return this.docs.find((d) => matches(d, filter)) ?? null
  }
  async findOneAndUpdate(filter: Doc, update: { $set: Doc }) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (!hit) return null
    Object.assign(hit, update.$set)

    return hit
  }
  async findOneAndDelete(filter: Doc) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (!hit) return null
    this.docs = this.docs.filter((d) => d !== hit)

    return hit
  }
  async deleteOne(filter: Doc) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (hit) this.docs = this.docs.filter((d) => d !== hit)

    return { deletedCount: hit ? 1 : 0 }
  }
  async createIndex() {
    return ''
  }
}

const collections = new Map<string, FakeCollection>()
const collection = (name: string) => {
  let existing = collections.get(name)

  if (!existing) {
    existing = new FakeCollection()
    collections.set(name, existing)
  }

  return existing
}
const sessions = () => collection('native_auth_sessions')

const USER = {
  id: '507f1f77bcf86cd799439011',
  email: 'bruce@example.com',
  name: 'Bruce',
  username: 'bruce',
  avatarURL: '',
  language: 'en-US',
  createdAt: '2026-01-01T00:00:00.000Z',
}

useDb({ db: (() => ({ collection })) as unknown as typeof dbActual.db })
useIdentity({
  getNuphosUserById: (async (id: string) =>
    id === USER.id ? USER : null) as unknown as typeof identityActual.getNuphosUserById,
  signNuphosToken: ((userId: string) =>
    `token-for-${userId}`) as unknown as typeof identityActual.signNuphosToken,
})

const {
  abandonNativeSession,
  completeNativeSession,
  findNativeDeliveryTarget,
  findPendingNativeSession,
  isLoopbackRedirectUri,
  redeemNativeSession,
  registerNativeSession,
} = await import('@/lib/native-auth')

const VERIFIER = 'a'.repeat(64)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const REDIRECT = 'http://127.0.0.1:51000/callback'

/** Completes the browser leg and hands back the one-time delivery code. */
async function complete(handle: string, userId: string = USER.id): Promise<string> {
  const done = await completeNativeSession(handle, userId)

  if (!done) throw new Error('completeNativeSession refused')

  return done.deliveryCode
}

const register = (over: Record<string, unknown> = {}) =>
  registerNativeSession({
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    clientState: 'corr123',
    ...over,
  })

beforeEach(() => {
  for (const c of collections.values()) c.docs = []
})

describe('the happy path', () => {
  test('register, complete, redeem', async () => {
    const { handle, expiresInSec } = await register()

    expect(handle).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(expiresInSec).toBe(600)

    // The landing page resolves the delivery target from the registration —
    // it never supplies one.
    expect(await findPendingNativeSession(handle)).toEqual({
      redirectUri: REDIRECT,
      clientState: 'corr123',
    })

    const deliveryCode = await complete(handle)

    const { token, user } = await redeemNativeSession(handle, VERIFIER, deliveryCode)

    expect(token).toBe(`token-for-${USER.id}`)
    expect(user).toEqual(USER)
  })

  test('the handle is never stored in the clear', async () => {
    const { handle } = await register()
    const stored = sessions().docs[0]!

    expect(stored._id).not.toBe(handle)
    expect(stored._id).toBe(createHash('sha256').update(handle).digest('base64url'))
  })

  test('no credential is held between the browser leg and redemption', async () => {
    const { handle } = await register()
    const deliveryCode = await complete(handle)

    // Only a user id and two hashes — the token is minted at redeem time, so a
    // dump of this collection contains nothing usable.
    expect(JSON.stringify(sessions().docs[0])).not.toContain('token-for-')
    expect(sessions().docs[0]!.userId).toBe(USER.id)
    expect(sessions().docs[0]!.deliveryCodeHash).toBe(
      createHash('sha256').update(deliveryCode).digest('base64url'),
    )
    expect(JSON.stringify(sessions().docs[0])).not.toContain(deliveryCode)
  })
})

describe('single use', () => {
  test('a handle cannot be redeemed twice', async () => {
    const { handle } = await register()
    const deliveryCode = await complete(handle)

    await redeemNativeSession(handle, VERIFIER, deliveryCode)
    await expect(redeemNativeSession(handle, VERIFIER, deliveryCode)).rejects.toThrow(
      /no longer valid/,
    )
    expect(sessions().docs).toHaveLength(0)
  })

  test('a replayed browser callback cannot re-arm a completed handle', async () => {
    const { handle } = await register()
    const first = await complete(handle)

    // Second callback for the same handle: the compare-and-set must fail rather
    // than rebind it to someone else — or mint a second usable delivery code.
    expect(await completeNativeSession(handle, 'aaaaaaaaaaaaaaaaaaaaaaaa')).toBeNull()
    expect(sessions().docs[0]!.userId).toBe(USER.id)
    expect(sessions().docs[0]!.deliveryCodeHash).toBe(
      createHash('sha256').update(first).digest('base64url'),
    )
  })

  test('a redeemed handle is no longer a pending delivery target', async () => {
    const { handle } = await register()
    const deliveryCode = await complete(handle)

    await redeemNativeSession(handle, VERIFIER, deliveryCode)
    expect(await findPendingNativeSession(handle)).toBeNull()
  })
})

describe('expiry', () => {
  test('an expired handle cannot be redeemed, even with the right delivery code', async () => {
    const { handle } = await register()
    const deliveryCode = await complete(handle)

    // The TTL reaper is lazy, so expiry must be enforced in code.
    sessions().docs[0]!.expiresAt = new Date(Date.now() - 1000)

    await expect(redeemNativeSession(handle, VERIFIER, deliveryCode)).rejects.toThrow(
      /no longer valid/,
    )
  })

  test('an expired handle is not a usable delivery target', async () => {
    const { handle } = await register()

    sessions().docs[0]!.expiresAt = new Date(Date.now() - 1000)

    expect(await findPendingNativeSession(handle)).toBeNull()
    expect(await completeNativeSession(handle, USER.id)).toBeNull()
  })
})

// PKCE proves *who registered the handle*. That is a real property, but it is
// not the one that matters most here, because the registrant may be an attacker
// who lured someone else into finishing the flow. See the delivery-code block.
describe('PKCE binds the handle to the process that registered it', () => {
  test('a wrong verifier is rejected', async () => {
    const { handle } = await register()
    const deliveryCode = await complete(handle)

    await expect(redeemNativeSession(handle, 'b'.repeat(64), deliveryCode)).rejects.toThrow(
      /no longer valid/,
    )
  })

  test('a wrong verifier does not destroy the session', async () => {
    // Otherwise anyone who learned the handle could deny the real app its
    // session by redeeming with garbage first.
    const { handle } = await register()
    const deliveryCode = await complete(handle)

    await expect(redeemNativeSession(handle, 'b'.repeat(64), deliveryCode)).rejects.toThrow()
    const { token } = await redeemNativeSession(handle, VERIFIER, deliveryCode)

    expect(token).toBe(`token-for-${USER.id}`)
  })

  test('registration insists on S256 and a well-formed challenge', async () => {
    await expect(register({ codeChallengeMethod: 'plain' })).rejects.toThrow(/S256/)
    await expect(register({ codeChallengeMethod: undefined })).rejects.toThrow(/S256/)
    await expect(register({ codeChallenge: 'too-short' })).rejects.toThrow(/base64url/)
    await expect(register({ codeChallenge: 123 })).rejects.toThrow(/base64url/)
  })
})

describe('the delivery code binds the session to the machine that received the redirect', () => {
  test('the registrant cannot redeem an identity bound by somebody else', async () => {
    // The attack this exists to stop. The attacker registers the handle, so the
    // handle and the verifier are both theirs; the victim's browser is lured
    // into finishing the flow, which binds the victim's identity. The delivery
    // code goes out on a loopback redirect to the victim's machine, so the
    // attacker never sees it.
    const attackerVerifier = 'z'.repeat(64)
    const attackerChallenge = createHash('sha256').update(attackerVerifier).digest('base64url')
    const { handle } = await register({ codeChallenge: attackerChallenge })

    const deliveryCode = await complete(handle, USER.id)

    await expect(redeemNativeSession(handle, attackerVerifier, undefined)).rejects.toThrow(
      /no longer valid/,
    )
    await expect(redeemNativeSession(handle, attackerVerifier, '')).rejects.toThrow(
      /no longer valid/,
    )
    await expect(redeemNativeSession(handle, attackerVerifier, 'guessed-code')).rejects.toThrow(
      /no longer valid/,
    )

    // ...and the victim's real app, which did receive the redirect, still can.
    expect(deliveryCode).toBeTruthy()
  })

  test('a wrong delivery code does not destroy the session', async () => {
    const { handle } = await register()
    const deliveryCode = await complete(handle)

    await expect(redeemNativeSession(handle, VERIFIER, 'wrong-code')).rejects.toThrow()
    expect(sessions().docs).toHaveLength(1)

    const { token } = await redeemNativeSession(handle, VERIFIER, deliveryCode)

    expect(token).toBe(`token-for-${USER.id}`)
  })

  test('a delivery code works exactly once', async () => {
    const { handle } = await register()
    const deliveryCode = await complete(handle)

    await redeemNativeSession(handle, VERIFIER, deliveryCode)
    await expect(redeemNativeSession(handle, VERIFIER, deliveryCode)).rejects.toThrow(
      /no longer valid/,
    )
  })

  test('a delivery code from one flow cannot redeem another', async () => {
    const first = await register()
    const second = await register()
    const firstCode = await complete(first.handle)

    await complete(second.handle)

    await expect(redeemNativeSession(second.handle, VERIFIER, firstCode)).rejects.toThrow(
      /no longer valid/,
    )
  })

  test('every completion mints a fresh code', async () => {
    const a = await register()
    const b = await register()

    expect(await complete(a.handle)).not.toBe(await complete(b.handle))
  })
})

describe('the delivery target is constrained at registration', () => {
  test('only loopback /callback URLs with an explicit high port are accepted', async () => {
    for (const redirectUri of [
      'https://evil.example.com/callback',
      'http://evil.example.com/callback',
      'http://127.0.0.1:51000/not-callback',
      'http://127.0.0.1/callback', // no explicit port
      'http://127.0.0.1:80/callback', // privileged
      'http://127.0.0.1:51000/callback?token=x', // pre-seeded query
      'http://127.0.0.1:51000/callback#x',
      'nuphos://callback',
      'not a url',
    ]) {
      await expect(register({ redirectUri })).rejects.toThrow(/loopback/)
    }
    expect(sessions().docs).toHaveLength(0)
  })

  test('the shapes the desktop actually binds are accepted', () => {
    expect(isLoopbackRedirectUri('http://127.0.0.1:51000/callback')).toBe(true)
    expect(isLoopbackRedirectUri('http://localhost:60123/callback')).toBe(true)
    expect(isLoopbackRedirectUri('http://[::1]:60123/callback')).toBe(true)
  })

  test('a malformed clientState is refused rather than echoed into a URL', async () => {
    await expect(register({ clientState: 'has spaces!' })).rejects.toThrow(/opaque/)
    await expect(register({ clientState: 'x'.repeat(200) })).rejects.toThrow(/opaque/)
  })
})

describe('unknown and abandoned handles', () => {
  test('an unknown handle yields no delivery target and cannot be redeemed', async () => {
    expect(await findPendingNativeSession('nope')).toBeNull()
    expect(await findPendingNativeSession(undefined)).toBeNull()
    await expect(redeemNativeSession('nope', VERIFIER, 'code')).rejects.toThrow(/no longer valid/)
    await expect(redeemNativeSession(undefined, VERIFIER, 'code')).rejects.toThrow(
      /no longer valid/,
    )
  })

  test('redeeming before the browser leg finishes reports pending, not failure', async () => {
    // So the app can keep waiting instead of tearing the flow down.
    const { handle } = await register()

    await expect(redeemNativeSession(handle, VERIFIER, 'any-code')).rejects.toThrow(
      /has not completed/,
    )
  })

  test('an abandoned handle is gone', async () => {
    const { handle } = await register()

    await abandonNativeSession(handle)
    expect(await findPendingNativeSession(handle)).toBeNull()
    expect(sessions().docs).toHaveLength(0)
  })
})

// The landing page's fallback when the sign-in call it was about to make never
// returned: without this the desktop waits on a listener nothing will hit.
describe('resolving a handle to its delivery target', () => {
  test('resolves where to send the browser, and nothing more', async () => {
    const { handle } = await register()

    const target = await findNativeDeliveryTarget(handle)

    expect(target).toEqual({ redirectUri: REDIRECT, clientState: 'corr123' })
  })

  test('refuses to disclose anything redemption is meant to gate', async () => {
    // The whole point of the endpoint: a caller holding only a handle must not
    // learn the token, the identity behind it, or the PKCE challenge.
    const { handle } = await register()
    const deliveryCode = await complete(handle)

    const target = await findNativeDeliveryTarget(handle)

    expect(Object.keys(target!).sort((a, b) => a.localeCompare(b))).toEqual([
      'clientState',
      'redirectUri',
    ])
    const serialized = JSON.stringify(target)

    expect(serialized).not.toContain(USER.id)
    expect(serialized).not.toContain(USER.email)
    expect(serialized).not.toContain('token-for-')
    expect(serialized).not.toContain(deliveryCode)
    expect(serialized).not.toContain(CHALLENGE)
    expect(serialized).not.toContain('pending')
    expect(serialized).not.toContain('ready')
  })

  test('does not consume the session, so a retry can still finish', async () => {
    const { handle } = await register()

    // The transient-failure sequence: look up, redirect, user retries.
    expect(await findNativeDeliveryTarget(handle)).not.toBeNull()
    expect(await findNativeDeliveryTarget(handle)).not.toBeNull()

    expect(sessions().docs).toHaveLength(1)
    expect(await findPendingNativeSession(handle)).toEqual({
      redirectUri: REDIRECT,
      clientState: 'corr123',
    })
    const deliveryCode = await complete(handle)

    expect((await redeemNativeSession(handle, VERIFIER, deliveryCode)).token).toBe(
      `token-for-${USER.id}`,
    )
  })

  test('a completed-but-undelivered session still resolves', async () => {
    // The common shape of the bug: our request timed out, the backend finished
    // anyway, and the delivery code went out in a response nobody received.
    const { handle } = await register()

    await complete(handle)

    expect(await findNativeDeliveryTarget(handle)).toEqual({
      redirectUri: REDIRECT,
      clientState: 'corr123',
    })
    // findPendingNativeSession, by contrast, is pending-only — the two are not
    // interchangeable.
    expect(await findPendingNativeSession(handle)).toBeNull()
  })

  test('an unknown, redeemed, abandoned or expired handle resolves to nothing', async () => {
    expect(await findNativeDeliveryTarget('nope')).toBeNull()
    expect(await findNativeDeliveryTarget(undefined)).toBeNull()
    expect(await findNativeDeliveryTarget('')).toBeNull()

    const redeemed = await register()
    const code = await complete(redeemed.handle)

    await redeemNativeSession(redeemed.handle, VERIFIER, code)
    expect(await findNativeDeliveryTarget(redeemed.handle)).toBeNull()

    const abandoned = await register()

    await abandonNativeSession(abandoned.handle)
    expect(await findNativeDeliveryTarget(abandoned.handle)).toBeNull()

    const expired = await register()

    for (const doc of sessions().docs) doc.expiresAt = new Date(Date.now() - 1000)
    expect(await findNativeDeliveryTarget(expired.handle)).toBeNull()
  })
})
