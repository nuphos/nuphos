import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'

import { Hono } from 'hono'

import { config } from '@/config'
import { errorHandler } from '@/lib/errors'
import { authenticateToken } from '@/lib/identity/auth'
import { revokeUserSession } from '@/lib/identity/sessions'
import { signInSocial } from '@/lib/identity/social'
import { registerNativeSession, redeemNativeSession } from '@/lib/native-auth'
import { useDb } from '@/lib/test/doubles/db'
import { socialAuth } from '@/routes/auth-social'

type Doc = Record<string, unknown>
const app = new Hono().onError(errorHandler).route('/', socialAuth)
const docs = new Map<string, Doc[]>()
const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && '$gt' in value)
      return doc[key] instanceof Date && doc[key].getTime() > (value.$gt as Date).getTime()
    if (value && typeof value === 'object' && '$exists' in value)
      return (doc[key] !== undefined) === value.$exists

    return String(doc[key]) === String(value)
  })

useDb({
  db: () => ({
    collection: (name: string) => ({
      findOne: async (filter: Doc) =>
        (docs.get(name) ?? []).find((doc) => matches(doc, filter)) ?? null,
      find: (filter: Doc) => ({
        limit: () => ({
          toArray: async () => (docs.get(name) ?? []).filter((doc) => matches(doc, filter)),
        }),
      }),
      updateOne: async () => ({ modifiedCount: 1 }),
      deleteOne: async (filter: Doc) => {
        const list = docs.get(name) ?? []
        const index = list.findIndex((doc) => matches(doc, filter))

        if (index < 0) return { deletedCount: 0 }
        list.splice(index, 1)

        return { deletedCount: 1 }
      },
      insertOne: async (doc: Doc) => {
        if (!docs.has(name)) {
          docs.set(name, [])
        }
        docs.get(name)?.push(doc)
      },
      findOneAndUpdate: async (filter: Doc, update: { $set: Doc }) => {
        const doc = (docs.get(name) ?? []).find((item) => matches(item, filter))

        if (!doc) return null
        Object.assign(doc, update.$set)

        return doc
      },
      findOneAndDelete: async (filter: Doc) => {
        const list = docs.get(name) ?? []
        const index = list.findIndex((doc) => matches(doc, filter))

        return index < 0 ? null : list.splice(index, 1)[0]
      },
    }),
  }),
})
beforeEach(() => {
  docs.clear()
  config.auth.apple.clientId = undefined
  config.auth.google.clientId = 'test-client'
  config.auth.google.clientSecret = 'test-secret'
})
test('provider chooser offers only configured providers without reflecting arbitrary handles', async () => {
  const response = await app.request('/login')

  expect(response.status).toBe(200)
  expect(response.headers.get('x-nuphos-social-login')).toBe('1')
  const html = await response.text()

  expect(html).toContain('Continue with Google')
  expect(html).not.toContain('Continue with Apple')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect((await app.request('/login?handle=%3Cscript%3E')).status).toBe(400)

  Object.assign(config.auth.apple, {
    clientId: 'test-apple',
    teamId: 'TEAM',
    keyId: 'KEY',
    privateKey: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
      format: 'pem',
      type: 'pkcs8',
    }),
  })
  expect(await (await app.request('/login')).text()).toContain('Continue with Apple')
})
test('chooser is unavailable until a provider is configured', async () => {
  config.auth.google.clientId = undefined
  const response = await app.request('/login')

  expect(response.status).toBe(503)
  expect(response.headers.get('x-nuphos-social-login')).toBeNull()
})
test('browser correlation cookie is required; cancellation consumes state once', async () => {
  const start = await app.request('/google/start')

  expect(start.status).toBe(302)
  const url = new URL(start.headers.get('location')!)
  const state = url.searchParams.get('state')!

  expect(url.searchParams.get('nonce')).toBeTruthy()
  expect(start.headers.get('set-cookie')).toContain('HttpOnly')
  const callback = `/google/callback?state=${state}&error=access_denied`

  expect((await app.request(callback)).status).toBe(400)
  const headers = { cookie: `__Host-nuphos-oauth=${state}` }

  expect((await app.request(callback, { headers })).status).toBe(401)
  expect((await app.request(callback, { headers })).status).toBe(400)
})
test('state cannot be moved to another provider or used after expiry', async () => {
  const start = await app.request('/google/start')
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!
  const headers = { cookie: `__Host-nuphos-oauth=${state}` }

  expect((await app.request(`/apple/callback?state=${state}&code=x`, { headers })).status).toBe(400)
  docs.get('social_auth_attempts')![0]!.expiresAt = new Date(0)
  expect((await app.request(`/google/callback?state=${state}&code=x`, { headers })).status).toBe(
    400,
  )
})
test('Apple private relay sign-up is keyed by subject on subsequent logins', async () => {
  const first = await signInSocial('apple', {
    sub: 'apple-sub',
    email: 'relay@privaterelay.appleid.com',
    email_verified: 'true',
  })

  expect((await signInSocial('apple', { sub: 'apple-sub' })).user.id).toBe(first.user.id)
})
test('same email does not silently link accounts', async () => {
  await signInSocial('google', {
    sub: 'google-sub',
    email: 'person@example.com',
    email_verified: true,
  })
  await expect(
    signInSocial('apple', { sub: 'apple-sub', email: 'person@example.com', email_verified: true }),
  ).rejects.toThrow('existing account')
})
test('unverified email cannot create an account', async () => {
  await expect(
    signInSocial('apple', { sub: 'apple-sub', email: 'person@example.com', email_verified: false }),
  ).rejects.toThrow()
})

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})
for (const native of [true, false]) {
  test(
    native
      ? 'native callback delivers a code bound to the original PKCE verifier'
      : 'browser callback creates a revocable session',
    async () => {
      const verifier = 'v'.repeat(43)
      const registration = await registerNativeSession({
        redirectUri: 'nuphos://google-callback',
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
        codeChallengeMethod: 'S256',
        clientState: 'ios-state',
      })
      const start = await app.request(
        native ? `/google/start?handle=${registration.handle}` : '/google/start',
      )
      const authorization = new URL(start.headers.get('location')!)
      const state = authorization.searchParams.get('state')!
      const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      const kid = native ? 'native-integration-key' : 'browser-integration-key'
      const payload = {
        iss: 'https://accounts.google.com',
        aud: 'test-client',
        sub: 'native-subject',
        email: 'native@example.com',
        email_verified: true,
        nonce: authorization.searchParams.get('nonce'),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      }
      const unsigned = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
      const token = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), rsa.privateKey).toString('base64url')}`

      globalThis.fetch = (async (url: unknown) =>
        Response.json(
          String(url).endsWith('/token')
            ? { id_token: token }
            : { keys: [{ ...rsa.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256' }] },
        )) as typeof fetch
      const response = await app.request(`/google/callback?state=${state}&code=provider-code`, {
        headers: { cookie: `__Host-nuphos-oauth=${state}` },
      })

      if (!native) {
        expect(response.status).toBe(200)
        const cookie = response.headers
          .getSetCookie()
          .find((value) => value.startsWith('__Host-nuphos-social='))!
          .split(';')[0]!
        const sessionToken = cookie.slice(cookie.indexOf('=') + 1)

        expect(sessionToken.startsWith('nus_')).toBe(true)
        expect(response.headers.get('set-cookie')).toContain('HttpOnly')
        const identity = await authenticateToken(sessionToken)

        expect(identity?.sessionId).toBeTruthy()
        expect(identity?.user.email).toBe('native@example.com')
        expect((await app.request('/session', { headers: { cookie } })).status).toBe(200)
        await revokeUserSession(identity!.user.id, identity!.sessionId!)
        expect((await app.request('/session', { headers: { cookie } })).status).toBe(401)

        return
      }
      expect(docs.get('user_sessions') ?? []).toHaveLength(0)
      expect(response.status).toBe(302)
      const callback = new URL(response.headers.get('location')!)

      expect(callback.searchParams.get('state')).toBe('ios-state')
      expect(callback.searchParams.has('token')).toBe(false)
      const code = callback.searchParams.get('code')!

      await expect(redeemNativeSession(registration.handle, 'x'.repeat(43), code)).rejects.toThrow()
      expect((await redeemNativeSession(registration.handle, verifier, code)).email).toBe(
        'native@example.com',
      )
      await expect(redeemNativeSession(registration.handle, verifier, code)).rejects.toThrow()
    },
  )
}
