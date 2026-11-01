import { generateKeyPairSync, sign } from 'node:crypto'

import { afterEach, expect, test } from 'bun:test'

import { config } from '@/config'
import { exchangeSocialCode, providerSettings, validateClaims } from '@/lib/identity/social'

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'social-test', alg: 'RS256' }
const originalFetch = globalThis.fetch
const originalGoogle = { ...config.auth.google }
const originalApple = { ...config.auth.apple }

afterEach(() => {
  globalThis.fetch = originalFetch
  Object.assign(config.auth.google, originalGoogle)
  Object.assign(config.auth.apple, originalApple)
})
function claims(provider: 'google' | 'apple') {
  return {
    iss: provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com',
    aud: 'client',
    sub: 'subject',
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    nonce: 'nonce',
  }
}
for (const provider of ['google', 'apple'] as const) {
  test(`${provider}: accepts expected claims`, () => {
    expect(validateClaims(claims(provider), provider, 'client', 'nonce').sub).toBe('subject')
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
        validateClaims({ ...claims(provider), [key]: value }, provider, 'client', 'nonce'),
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
test('unconfigured Apple fails closed', () => {
  config.auth.apple.clientId = undefined
  expect(() => providerSettings('apple')).toThrow('not configured')
})
