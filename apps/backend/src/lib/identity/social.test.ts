import { generateKeyPairSync, sign } from 'node:crypto'

import { afterEach, expect, test } from 'bun:test'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

import { config } from '@/config'
import { exchangeSocialCode, providerSettings, validateClaims } from '@/lib/identity/social'

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'social-test', alg: 'RS256' }
const originalFetch = globalThis.fetch
const originalGoogle = { ...config.auth.google }
const originalApple = { ...config.auth.apple }
const originalOidc = { ...config.auth.oidc }

afterEach(() => {
  globalThis.fetch = originalFetch
  Object.assign(config.auth.google, originalGoogle)
  Object.assign(config.auth.apple, originalApple)
  Object.assign(config.auth.oidc, originalOidc)
})

const issuerOf = (provider: 'google' | 'apple') =>
  provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com'

function claims(provider: 'google' | 'apple') {
  return {
    iss: issuerOf(provider),
    aud: 'client',
    sub: 'subject',
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    nonce: 'nonce',
  }
}
for (const provider of ['google', 'apple'] as const) {
  test(`${provider}: accepts expected claims`, () => {
    expect(validateClaims(claims(provider), [issuerOf(provider)], 'client', 'nonce').sub).toBe(
      'subject',
    )
  })
  for (const [key, value] of Object.entries({
    iss: 'https://attacker.invalid',
    aud: 'wrong',
    exp: 1,
    iat: Date.now() / 1000 + 3600,
    sub: '',
    nonce: 'wrong',
  })) {
    test(`${provider}: rejects invalid ${key}`, () => {
      expect(() =>
        validateClaims(
          { ...claims(provider), [key]: value },
          [issuerOf(provider)],
          'client',
          'nonce',
        ),
      ).toThrow()
    })
  }
  test(`${provider}: verifies signature before accepting identity`, async () => {
    config.auth.google.clientId = 'client'
    config.auth.google.clientSecret = 'secret'
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })

    Object.assign(config.auth.apple, {
      clientId: 'client',
      teamId: 'team',
      keyId: 'key',
      privateKey: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    })
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url')}.${Buffer.from(JSON.stringify(claims(provider))).toString('base64url')}`
    let token = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), rsa.privateKey).toString('base64url')}`

    globalThis.fetch = (async (url: unknown) =>
      Response.json(
        String(url).endsWith('/token') ? { id_token: token } : { keys: [jwk] },
      )) as typeof fetch
    expect((await exchangeSocialCode(provider, 'code', 'nonce')).sub).toBe('subject')
    await expect(exchangeSocialCode(provider, 'code', 'wrong')).rejects.toThrow()
    token = `${unsigned}.${Buffer.alloc(256).toString('base64url')}`
    await expect(exchangeSocialCode(provider, 'code', 'nonce')).rejects.toThrow()
  })
}
test('unconfigured Apple fails closed', async () => {
  config.auth.apple.clientId = undefined
  await expect(providerSettings('apple')).rejects.toThrow('not configured')
})

test('unconfigured OIDC fails closed', async () => {
  config.auth.oidc.issuer = undefined
  await expect(providerSettings('oidc')).rejects.toThrow('not configured')
})

const ISSUER = 'https://sso.example.test/oidc'

async function oidcProvider(configured = ISSUER, advertised = configured) {
  const { privateKey, publicKey } = await generateKeyPair('ES384')
  const key = { ...(await exportJWK(publicKey)), kid: 'oidc-test', alg: 'ES384', use: 'sig' }

  Object.assign(config.auth.oidc, {
    issuer: configured,
    clientId: 'client',
    clientSecret: 'secret',
  })
  const mint = (audience = 'client') =>
    new SignJWT({ nonce: 'nonce', email: 'p@example.com', email_verified: true })
      .setProtectedHeader({ alg: 'ES384', kid: 'oidc-test' })
      .setIssuer(configured)
      .setAudience(audience)
      .setSubject('logto-user')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
  let token = await mint()

  globalThis.fetch = (async (url: unknown) => {
    const href = String(url)

    if (href.endsWith('/.well-known/openid-configuration'))
      return Response.json({
        issuer: advertised,
        authorization_endpoint: `${configured}/auth`,
        token_endpoint: `${configured}/token`,
        jwks_uri: `${configured}/jwks`,
      })
    if (href.endsWith('/token')) return Response.json({ id_token: token })

    return Response.json({ keys: [key] })
  }) as typeof fetch

  return {
    setToken: (next: string) => {
      token = next
    },
    mint,
  }
}

test('oidc: discovers endpoints and verifies an ES384 ID token', async () => {
  const { setToken, mint } = await oidcProvider()

  expect((await providerSettings('oidc')).authorize).toBe(`${ISSUER}/auth`)
  expect((await exchangeSocialCode('oidc', 'code', 'nonce')).sub).toBe('logto-user')
  await expect(exchangeSocialCode('oidc', 'code', 'wrong')).rejects.toThrow()
  setToken(await mint('another-client'))
  await expect(exchangeSocialCode('oidc', 'code', 'nonce')).rejects.toThrow()
  const forged = await generateKeyPair('ES384')

  setToken(
    await new SignJWT({ nonce: 'nonce' })
      .setProtectedHeader({ alg: 'ES384', kid: 'oidc-test' })
      .setIssuer(ISSUER)
      .setAudience('client')
      .setSubject('logto-user')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(forged.privateKey),
  )
  await expect(exchangeSocialCode('oidc', 'code', 'nonce')).rejects.toThrow()
})

test('oidc: refuses a discovery document for another issuer', async () => {
  await oidcProvider('https://other.example.test/oidc', 'https://attacker.invalid')
  await expect(providerSettings('oidc')).rejects.toThrow('discovery failed')
})
