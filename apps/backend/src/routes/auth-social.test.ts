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
  config.auth.oidc.issuer = undefined
  config.auth.google.clientId = 'test-client'
  config.auth.google.clientSecret = 'test-secret'
})
test('provider chooser offers only configured providers without reflecting arbitrary handles', async () => {
  const response = await app.request('/login')

  expect(response.status).toBe(200)
  expect(response.headers.get('x-nuphos-social-login')).toBe('1')
  expect(response.headers.get('x-nuphos-social-providers')).toBe('google')
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
  const withApple = await app.request('/login')

  expect(withApple.headers.get('x-nuphos-social-providers')).toBe('google,apple')
  expect(await withApple.text()).toContain('Continue with Apple')
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
test('start keeps the first-touch cookie, which a cross-site POST callback would not carry', async () => {
  const firstTouch = JSON.stringify({ channel: 'x' })

  await app.request('/google/start', {
    headers: { cookie: `nuphos_first_touch=${encodeURIComponent(firstTouch)}` },
  })

  expect(docs.get('social_auth_attempts')?.[0]?.firstTouch).toBe(firstTouch)
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
test('OIDC links a verified email to an existing account, once', async () => {
  const existing = await signInSocial('google', {
    sub: 'google-sub',
    email: 'person@example.com',
    email_verified: true,
  })
  const linked = await signInSocial('oidc', {
    sub: 'logto-sub',
    email: 'Person@example.com',
    email_verified: true,
  })

  expect(linked.user.id).toBe(existing.user.id)
  docs.get('users')![0]!.oidcID = 'logto-sub'
  await expect(
    signInSocial('oidc', { sub: 'other-sub', email: 'person@example.com', email_verified: true }),
  ).rejects.toThrow('existing account')
  await expect(
    signInSocial('oidc', { sub: 'new-sub', email: 'new@example.com', email_verified: false }),
  ).rejects.toThrow()
})
test('chooser names the OIDC provider', async () => {
  Object.assign(config.auth.oidc, {
    issuer: 'https://sso.example.test/oidc',
    clientId: 'c',
    clientSecret: 's',
    name: 'Logto <SSO>',
  })
  globalThis.fetch = (async (_url: unknown) =>
    Response.json({
      issuer: 'https://sso.example.test/oidc',
      authorization_endpoint: 'https://sso.example.test/oidc/auth',
      token_endpoint: 'https://sso.example.test/oidc/token',
      jwks_uri: 'https://sso.example.test/oidc/jwks',
    })) as typeof fetch
  const response = await app.request('/login')

  expect(response.headers.get('x-nuphos-social-providers')).toBe('google,oidc')
  expect(response.headers.get('x-nuphos-social-oidc-name')).toBe('Logto <SSO>')
  expect(await response.text()).toContain('Continue with Logto &#60;SSO&#62;')
  const start = new URL((await app.request('/oidc/start')).headers.get('location')!)

  expect(start.origin + start.pathname).toBe('https://sso.example.test/oidc/auth')
  expect(start.searchParams.get('redirect_uri')).toEndWith('/auth/social/oidc/callback')
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

test('device page asks for sign-in and returns to itself with the code', async () => {
  const response = await app.request('/device?code=abcd-efgh')
  const html = await response.text()

  expect(response.status).toBe(200)
  expect(html).toContain(
    `google/start?next=${encodeURIComponent('/auth/social/device?code=abcd-efgh')}`,
  )
  await app.request(`/google/start?next=${encodeURIComponent('/auth/social/device?code=X')}`)
  await app.request(`/google/start?next=${encodeURIComponent('https://evil.example/')}`)
  await app.request(`/google/start?next=${encodeURIComponent('//evil.example/auth/social/device')}`)
  const attempts = docs.get('social_auth_attempts')!

  expect(attempts.map((a) => a.next)).toEqual(['/auth/social/device?code=X', undefined, undefined])
})
test('device approval refuses other origins and anonymous posts', async () => {
  const post = (headers: Record<string, string>) =>
    app.request('/device', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: 'code=ABCDEFGH&decision=approve',
    })

  expect((await post({ 'sec-fetch-site': 'same-site' })).status).toBe(403)
  expect((await post({ 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  // What a browser sends from the page itself under no-referrer: allowed past the check.
  expect((await post({ 'sec-fetch-site': 'same-origin', origin: 'null' })).status).toBe(401)
  expect((await post({})).status).toBe(401)
})
test('"Use another account" makes the provider ask again', async () => {
  const location = async (path: string) =>
    new URL((await app.request(path)).headers.get('location')!).searchParams.get('prompt')

  expect(await location('/google/start')).toBeNull()
  expect(await location('/google/start?prompt=login')).toBe('select_account')
  expect(await location('/google/start?prompt=consent')).toBeNull()
})
