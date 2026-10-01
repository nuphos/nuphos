import { afterEach, describe, expect, test } from 'bun:test'
import { generateKeyPairSync, verify } from 'node:crypto'

import { isDeadToken, sendApns, setApnsTransportForTests, signProviderToken } from './apns'

import type { ApnsCredentials } from './apns'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const credentials: ApnsCredentials = {
  keyId: 'KEY123',
  teamId: 'TEAM456',
  bundleId: 'ai.nuphos.ios',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  environment: 'production',
}

afterEach(() => {
  setApnsTransportForTests(null)
})

describe('signProviderToken', () => {
  test('produces an ES256 JWT Apple can verify with the key', () => {
    const token = signProviderToken(credentials, 1_700_000_000_000)
    const [header, claims, signature] = token.split('.')

    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({
      alg: 'ES256',
      kid: 'KEY123',
    })
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString())).toEqual({
      iss: 'TEAM456',
      iat: 1_700_000_000,
    })
    const valid = verify(
      'sha256',
      Buffer.from(`${header ?? ''}.${claims ?? ''}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature ?? '', 'base64url'),
    )

    expect(valid).toBe(true)
  })
})

describe('sendApns', () => {
  test('posts to the environment host with alert headers and a reused provider token', async () => {
    const calls: { host: string; headers: Record<string, string>; body: string }[] = []

    setApnsTransportForTests(async (host, headers, body) => {
      calls.push({ host, headers, body })

      return { status: 200 }
    })
    const request = {
      deviceToken: 'ab'.repeat(32),
      environment: 'sandbox' as const,
      payload: { aps: { alert: { title: 't', body: 'b' } } },
      collapseId: 'session-1',
    }

    await sendApns(credentials, request, 0)
    await sendApns(credentials, { ...request, environment: 'production' }, 60_000)

    expect(calls[0]?.host).toBe('https://api.sandbox.push.apple.com')
    expect(calls[1]?.host).toBe('https://api.push.apple.com')
    expect(calls[0]?.headers[':path']).toBe(`/3/device/${'ab'.repeat(32)}`)
    expect(calls[0]?.headers['apns-topic']).toBe('ai.nuphos.ios')
    expect(calls[0]?.headers['apns-push-type']).toBe('alert')
    expect(calls[0]?.headers['apns-collapse-id']).toBe('session-1')
    expect(calls[0]?.headers.authorization).toStartWith('bearer ')
    expect(calls[1]?.headers.authorization).toBe(calls[0]?.headers.authorization ?? '')
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual(request.payload)
  })

  test('refreshes the provider token once it ages out', async () => {
    const tokens: string[] = []

    setApnsTransportForTests(async (_host, headers) => {
      tokens.push(headers.authorization ?? '')

      return { status: 200 }
    })
    const request = {
      deviceToken: 'cd'.repeat(32),
      environment: 'production' as const,
      payload: {},
    }

    await sendApns(credentials, request, 0)
    await sendApns(credentials, request, 50 * 60 * 1000)

    expect(tokens[0]).not.toBe(tokens[1])
  })
})

describe('isDeadToken', () => {
  test('prunes only on responses that say the token will never deliver', () => {
    expect(isDeadToken({ status: 410, reason: 'Unregistered' })).toBe(true)
    expect(isDeadToken({ status: 400, reason: 'BadDeviceToken' })).toBe(true)
    expect(isDeadToken({ status: 400, reason: 'DeviceTokenNotForTopic' })).toBe(true)
    expect(isDeadToken({ status: 400, reason: 'PayloadTooLarge' })).toBe(false)
    expect(isDeadToken({ status: 429, reason: 'TooManyRequests' })).toBe(false)
    expect(isDeadToken({ status: 200 })).toBe(false)
  })
})
