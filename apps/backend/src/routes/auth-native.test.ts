import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type * as dbActual from '@/lib/db'
import type * as identityActual from '@/lib/identity'

// Run with: cd apps/backend && bun test src/routes/auth-native.test.ts
//
// End-to-end over the HTTP surface: the native handoff and the legacy
// token-in-the-response path must both work, because a shipped desktop build
// keeps using the old one until it is replaced.
//
// Includes the account-takeover the delivery code exists to stop — see
// "an attacker who registered the handle".

type Doc = Record<string, unknown>

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$gt' in (expected as Doc)) {
      const value = doc[key]

      return value instanceof Date && value.getTime() > (expected as { $gt: Date }).$gt.getTime()
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

const USER = {
  id: '507f1f77bcf86cd799439011',
  email: 'bruce@example.com',
  name: 'Bruce',
  username: 'bruce',
  avatarURL: '',
  language: 'en-US',
  createdAt: '2026-01-01T00:00:00.000Z',
}

let googleSignIn: (
  code: string,
  redirectUri: string,
) => Promise<{ token: string; user: typeof USER }> = async (_code, _redirectUri) => ({
  token: 'google-session-token',
  user: USER,
})

useDb({ db: (() => ({ collection })) as unknown as typeof dbActual.db })
useIdentity({
  signInWithGoogleCode: ((code: string, redirectUri: string) =>
    googleSignIn(code, redirectUri)) as unknown as typeof identityActual.signInWithGoogleCode,
  getNuphosUserById: (async (id: string) =>
    id === USER.id ? USER : null) as unknown as typeof identityActual.getNuphosUserById,
  signNuphosToken: ((userId: string) =>
    `minted-for-${userId}`) as unknown as typeof identityActual.signNuphosToken,
})

const { auth } = await import('@/routes/auth')

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

const VERIFIER = 'a'.repeat(64)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const REDIRECT = 'http://127.0.0.1:51000/callback'
const NUPHOS_CALLBACK = 'https://nuphos.ai/api/google/callback'

async function registerHandle(codeChallenge = CHALLENGE): Promise<string> {
  const res = await post('/auth/native/session', {
    redirectUri: REDIRECT,
    codeChallenge,
    codeChallengeMethod: 'S256',
    clientState: 'corr123',
  })

  expect(res.status).toBe(201)

  return ((await res.json()) as { handle: string }).handle
}

/** Runs the browser leg and returns what the landing page would put on the redirect. */
async function browserLeg(
  handle: string,
): Promise<{ redirectUri: string; clientState?: string; code?: string }> {
  const res = await post('/auth/google/sign-in', {
    code: 'google-code',
    redirectUri: NUPHOS_CALLBACK,
    handle,
  })

  return (
    (await res.json()) as {
      nativeDelivery: { redirectUri: string; clientState?: string; code?: string }
    }
  ).nativeDelivery
}

beforeEach(() => {
  collections.forEach((c) => {
    c.docs = []
  })
  googleSignIn = async () => ({ token: 'google-session-token', user: USER })
})

describe('the native handoff', () => {
  test('a full sign-in never puts a credential in the response', async () => {
    const handle = await registerHandle()

    const res = await post('/auth/google/sign-in', {
      code: 'google-code',
      redirectUri: NUPHOS_CALLBACK,
      handle,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    // The landing page is told where to send the browser, plus the one-time
    // code that must ride that redirect and travel no other way.
    const delivery = body.nativeDelivery as {
      redirectUri: string
      clientState: string
      code: string
    }

    expect(delivery.redirectUri).toBe(REDIRECT)
    expect(delivery.clientState).toBe('corr123')
    expect(delivery.code).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(JSON.stringify(body)).not.toContain('google-session-token')
    const google = (
      body.data as {
        googleSignIn?: { token?: string; user?: { id: string } }
      }
    ).googleSignIn

    expect(google?.token).toBeUndefined()
    expect(google?.user).toEqual({ id: USER.id })
    expect(JSON.stringify(google)).not.toContain(USER.email)

    // The app then redeems directly, proving it registered the flow (verifier)
    // and received the redirect (code).
    const redeemed = await post('/auth/native/session/redeem', {
      handle,
      codeVerifier: VERIFIER,
      code: delivery.code,
    })

    expect(redeemed.status).toBe(200)
    expect(await redeemed.json()).toEqual({ token: `minted-for-${USER.id}`, user: USER })
  })

  test('redeeming twice fails the second time', async () => {
    const handle = await registerHandle()
    const { code } = await browserLeg(handle)

    expect(
      (await post('/auth/native/session/redeem', { handle, codeVerifier: VERIFIER, code })).status,
    ).toBe(200)

    const again = await post('/auth/native/session/redeem', {
      handle,
      codeVerifier: VERIFIER,
      code,
    })

    expect(again.status).toBe(400)
    expect((await again.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'invalid_handle' },
    })
  })

  test('the wrong verifier cannot redeem', async () => {
    const handle = await registerHandle()
    const { code } = await browserLeg(handle)

    const res = await post('/auth/native/session/redeem', {
      handle,
      codeVerifier: 'b'.repeat(64),
      code,
    })

    expect(res.status).toBe(400)
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'invalid_verifier' },
    })
  })

  test('the wrong delivery code cannot redeem, and does not burn the session', async () => {
    const handle = await registerHandle()
    const { code } = await browserLeg(handle)

    const res = await post('/auth/native/session/redeem', {
      handle,
      codeVerifier: VERIFIER,
      code: 'not-the-code',
    })

    expect(res.status).toBe(400)
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'invalid_delivery_code' },
    })

    // The real app, which did receive the redirect, is unaffected.
    expect(
      (await post('/auth/native/session/redeem', { handle, codeVerifier: VERIFIER, code })).status,
    ).toBe(200)
  })

  test('redeeming before the browser finishes reports pending', async () => {
    const handle = await registerHandle()
    const res = await post('/auth/native/session/redeem', {
      handle,
      codeVerifier: VERIFIER,
      code: 'anything',
    })

    expect(res.status).toBe(409)
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'authorization_pending' },
    })
  })

  test('an unknown handle is refused before Google is ever called', async () => {
    let called = false

    googleSignIn = async () => {
      called = true

      return { token: 't', user: USER }
    }

    const res = await post('/auth/google/sign-in', {
      code: 'c',
      redirectUri: NUPHOS_CALLBACK,
      handle: 'not-a-real-handle',
    })

    expect(res.status).toBe(400)
    expect(called).toBe(false)
    expect((await res.json()) as { nativeDelivery?: unknown }).not.toHaveProperty('nativeDelivery')
  })

  test('a failed Google exchange still returns the delivery target, and burns the handle', async () => {
    // Otherwise the app sits waiting on a listener nothing will ever hit.
    const handle = await registerHandle()

    googleSignIn = async () => {
      throw new Error('Google email is not verified')
    }

    const res = await post('/auth/google/sign-in', {
      code: 'c',
      redirectUri: NUPHOS_CALLBACK,
      handle,
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      nativeDelivery?: unknown
      errors?: { extensions?: { description?: string } }[]
    }

    expect(body.nativeDelivery).toEqual({ redirectUri: REDIRECT, clientState: 'corr123' })
    expect(body.errors?.[0]?.extensions?.description).toBe('Google email is not verified')

    expect(collection('native_auth_sessions').docs).toHaveLength(0)
    expect(
      (await post('/auth/native/session/redeem', { handle, codeVerifier: VERIFIER, code: 'x' }))
        .status,
    ).toBe(400)
  })

  test('a failed exchange carries no delivery code — there is nothing to redeem', async () => {
    const handle = await registerHandle()

    googleSignIn = async () => {
      throw new Error('Google email is not verified')
    }

    const res = await post('/auth/google/sign-in', {
      code: 'c',
      redirectUri: NUPHOS_CALLBACK,
      handle,
    })
    const { nativeDelivery } = (await res.json()) as {
      nativeDelivery: { redirectUri: string; code?: string }
    }

    expect(nativeDelivery.redirectUri).toBe(REDIRECT)
    expect(nativeDelivery.code).toBeUndefined()
  })

  test('registration rejects a delivery target that is not loopback', async () => {
    const res = await post('/auth/native/session', {
      redirectUri: 'https://evil.example.com/callback',
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    })

    expect(res.status).toBe(400)
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'invalid_redirect_uri' },
    })
  })
})

describe('resolving a handle to its delivery target', () => {
  // Exists so a landing page whose sign-in call never returned can still send
  // the browser back to the app instead of stranding it on its listener.
  test('returns only where to send the browser', async () => {
    const handle = await registerHandle()

    const res = await post('/auth/native/session/delivery', { handle })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ redirectUri: REDIRECT, clientState: 'corr123' })
  })

  test('never hands back a session, an identity, or a delivery code', async () => {
    const handle = await registerHandle()
    const { code } = await browserLeg(handle)

    const body = await (await post('/auth/native/session/delivery', { handle })).text()

    expect(body).not.toContain('minted-for-')
    expect(body).not.toContain(USER.id)
    expect(body).not.toContain(USER.email)
    expect(body).not.toContain(code!)
  })

  test('does not consume the session — the app can still redeem afterwards', async () => {
    const handle = await registerHandle()

    expect((await post('/auth/native/session/delivery', { handle })).status).toBe(200)
    const { code } = await browserLeg(handle)

    expect((await post('/auth/native/session/delivery', { handle })).status).toBe(200)

    const redeemed = await post('/auth/native/session/redeem', {
      handle,
      codeVerifier: VERIFIER,
      code,
    })

    expect(redeemed.status).toBe(200)
    expect(await redeemed.json()).toEqual({ token: `minted-for-${USER.id}`, user: USER })
  })

  test('an unknown or redeemed handle is a 404, not a delivery target', async () => {
    expect(
      (await post('/auth/native/session/delivery', { handle: 'not-a-real-handle' })).status,
    ).toBe(404)
    expect((await post('/auth/native/session/delivery', {})).status).toBe(404)

    const handle = await registerHandle()
    const { code } = await browserLeg(handle)

    await post('/auth/native/session/redeem', { handle, codeVerifier: VERIFIER, code })

    expect((await post('/auth/native/session/delivery', { handle })).status).toBe(404)
  })
})

describe('an attacker who registered the handle', () => {
  // The one-click remote account takeover this design has to stop.
  //
  // Registration is unauthenticated, so an attacker can run step 1 from their
  // own server, then send the victim a plain nuphos.ai link carrying the
  // handle. The victim sees a genuine Google account chooser and picks their
  // own account, which binds *their* identity to the attacker's handle. The
  // attacker holds the handle and the PKCE verifier — PKCE proves who
  // registered, not whose identity got bound — so those two alone must not be
  // enough. Only the delivery code is out of reach: it goes out on a loopback
  // redirect to the victim's machine, where the attacker cannot receive it.
  const ATTACKER_VERIFIER = 'z'.repeat(64)
  const ATTACKER_CHALLENGE = createHash('sha256').update(ATTACKER_VERIFIER).digest('base64url')

  test('cannot redeem a session for the victim it lured into the flow', async () => {
    // 1. Attacker registers, from anywhere, and keeps the verifier.
    const handle = await registerHandle(ATTACKER_CHALLENGE)

    // 2-4. The victim's browser completes the Google leg. The backend binds the
    // victim's identity to the attacker's handle — this part still succeeds,
    // and is exactly why the redemption side has to be the one that refuses.
    const res = await post('/auth/google/sign-in', {
      code: 'victim-code',
      redirectUri: NUPHOS_CALLBACK,
      handle,
    })

    expect(res.status).toBe(200)
    const { nativeDelivery } = (await res.json()) as { nativeDelivery: { code: string } }

    // 5. The loopback redirect lands on the victim's machine; the attacker
    // never receives it, so they have the handle and the verifier and nothing
    // else. Everything they can try must fail.
    // A near-miss too, not just obvious garbage.
    const nearMiss =
      nativeDelivery.code.slice(0, -1) + (nativeDelivery.code.endsWith('A') ? 'B' : 'A')

    for (const code of [undefined, '', 'guess', nearMiss]) {
      const attempt = await post('/auth/native/session/redeem', {
        handle,
        codeVerifier: ATTACKER_VERIFIER,
        code,
      })

      expect(attempt.status).not.toBe(200)
      expect(await attempt.text()).not.toContain(`minted-for-${USER.id}`)
    }

    // And nothing was consumed along the way, so the victim's own app — had
    // this been a real sign-in — would still be able to finish.
    expect(collection('native_auth_sessions').docs).toHaveLength(1)
  })

  test('cannot use a second registration to sidestep the first', async () => {
    // Re-registering mints a fresh handle with a fresh (pending) session; it
    // does not give the attacker a route into a session bound by someone else.
    const victimHandle = await registerHandle()
    const { code } = await browserLeg(victimHandle)

    const attackerHandle = await registerHandle(ATTACKER_CHALLENGE)

    expect(attackerHandle).not.toBe(victimHandle)

    // The attacker's handle with the victim's code, and vice versa.
    expect(
      (
        await post('/auth/native/session/redeem', {
          handle: attackerHandle,
          codeVerifier: ATTACKER_VERIFIER,
          code,
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await post('/auth/native/session/redeem', {
          handle: victimHandle,
          codeVerifier: ATTACKER_VERIFIER,
          code,
        })
      ).status,
    ).toBe(400)
  })
})

describe('the legacy path still works', () => {
  test('a sign-in without a handle returns the token and user as before', async () => {
    const res = await post('/auth/google/sign-in', {
      code: 'google-code',
      redirectUri: NUPHOS_CALLBACK,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: { googleSignIn: { token: 'google-session-token', user: USER } },
    })
    // Nothing was registered, so nothing is left behind either.
    expect(collection('native_auth_sessions').docs).toHaveLength(0)
  })

  test('a legacy failure keeps its existing error envelope', async () => {
    googleSignIn = async () => {
      throw new Error('Google token exchange failed: HTTP 400')
    }

    const res = await post('/auth/google/sign-in', { code: 'bad', redirectUri: NUPHOS_CALLBACK })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { nativeDelivery?: unknown; errors: { message: string }[] }

    expect(body.errors[0]!.message).toBe('Failed to sign in')
    expect(body).not.toHaveProperty('nativeDelivery')
  })

  test('missing code or redirectUri is still rejected the same way', async () => {
    expect((await post('/auth/google/sign-in', { redirectUri: NUPHOS_CALLBACK })).status).toBe(400)
    expect((await post('/auth/google/sign-in', { code: 'c' })).status).toBe(400)
  })
})
