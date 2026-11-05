import { afterEach, describe, expect, test } from 'bun:test'
import { generateKeyPairSync, verify } from 'node:crypto'

import {
  APNS_SEND_ATTEMPTS,
  apnsRetryDelayMs,
  isDeadToken,
  isTransientApnsFailure,
  sendApns,
  setApnsTransportForTests,
  signProviderToken,
} from './apns'

import type { ApnsCredentials, ApnsRequest } from './apns'

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
    expect(isDeadToken({ status: 403, reason: 'BadEnvironmentKeyInToken' })).toBe(true)
    expect(isDeadToken({ status: 403, reason: 'ExpiredProviderToken' })).toBe(false)
    expect(isDeadToken({ status: 403, reason: 'InvalidProviderToken' })).toBe(false)
    expect(isDeadToken({ status: 400, reason: 'PayloadTooLarge' })).toBe(false)
    expect(isDeadToken({ status: 429, reason: 'TooManyRequests' })).toBe(false)
    expect(isDeadToken({ status: 200 })).toBe(false)
  })
})

const request: ApnsRequest = {
  deviceToken: 'ef'.repeat(32),
  environment: 'production',
  payload: { aps: { alert: { title: 't', body: 'b' } } },
  collapseId: 'session-1',
}

function transportError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

// What Node rejects with when APNs RST_STREAMs the request.
function refusedStream(): Error {
  return transportError(
    'Stream closed with error code NGHTTP2_REFUSED_STREAM',
    'ERR_HTTP2_STREAM_ERROR',
  )
}

describe('sendApns transient failures', () => {
  test('retries a refused stream and delivers on the next attempt', async () => {
    let attempts = 0

    setApnsTransportForTests(async () => {
      attempts += 1
      if (attempts === 1) throw refusedStream()

      return { status: 200 }
    })

    expect(await sendApns(credentials, request, 0)).toEqual({ status: 200 })
    expect(attempts).toBe(2)
  })

  test('retries a stream that closed without a response', async () => {
    let attempts = 0

    setApnsTransportForTests(async () => {
      attempts += 1

      return attempts < APNS_SEND_ATTEMPTS ? { status: 0 } : { status: 200 }
    })

    expect(await sendApns(credentials, request, 0)).toEqual({ status: 200 })
    expect(attempts).toBe(APNS_SEND_ATTEMPTS)
  })

  test('gives up once every attempt has been refused', async () => {
    let attempts = 0

    setApnsTransportForTests(async () => {
      attempts += 1
      throw refusedStream()
    })

    await expect(sendApns(credentials, request, 0)).rejects.toThrow('NGHTTP2_REFUSED_STREAM')
    expect(attempts).toBe(APNS_SEND_ATTEMPTS)
  })

  test('does not retry a rejection APNs answered with a status', async () => {
    let attempts = 0

    setApnsTransportForTests(async () => {
      attempts += 1

      return { status: 400, reason: 'BadDeviceToken' }
    })

    expect(await sendApns(credentials, request, 0)).toEqual({
      status: 400,
      reason: 'BadDeviceToken',
    })
    expect(attempts).toBe(1)
  })

  test('does not retry a failure that is not a transport refusal', async () => {
    let attempts = 0

    setApnsTransportForTests(async () => {
      attempts += 1
      throw new Error('APNs request timed out')
    })

    await expect(sendApns(credentials, request, 0)).rejects.toThrow('timed out')
    expect(attempts).toBe(1)
  })
})

describe('isTransientApnsFailure', () => {
  test('accepts a refused stream and a socket that died mid-request', () => {
    expect(isTransientApnsFailure(refusedStream())).toBe(true)
    expect(isTransientApnsFailure(transportError('read ECONNRESET', 'ECONNRESET'))).toBe(true)
    expect(isTransientApnsFailure(transportError('goaway', 'ERR_HTTP2_GOAWAY_SESSION'))).toBe(true)
  })

  test('rejects a protocol error, a timeout, and a non-error', () => {
    expect(
      isTransientApnsFailure(
        transportError(
          'Stream closed with error code NGHTTP2_PROTOCOL_ERROR',
          'ERR_HTTP2_STREAM_ERROR',
        ),
      ),
    ).toBe(false)
    expect(isTransientApnsFailure(new Error('APNs request timed out'))).toBe(false)
    expect(isTransientApnsFailure('connection failed')).toBe(false)
  })
})

describe('apnsRetryDelayMs', () => {
  test('halves the exponential ceiling and jitters the rest of it', () => {
    expect(apnsRetryDelayMs(0, () => 0)).toBe(100)
    expect(apnsRetryDelayMs(0, () => 1)).toBe(200)
    expect(apnsRetryDelayMs(1, () => 0)).toBe(200)
    expect(apnsRetryDelayMs(1, () => 1)).toBe(400)
    expect(apnsRetryDelayMs(9, () => 1)).toBe(2_000)
  })
})
