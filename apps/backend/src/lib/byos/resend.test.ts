import { afterEach, describe, expect, test } from 'bun:test'

import { ResendApiError, verifyResendApiKey } from './resend'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch
}

describe('verifyResendApiKey', () => {
  test('reports full access and the verified domains when /domains reads back', async () => {
    stubFetch(200, {
      data: [
        { name: 'acme.com', status: 'verified' },
        { name: 'mail.acme.com', status: 'pending' },
      ],
    })
    const info = await verifyResendApiKey('re_full')

    expect(info.permission).toBe('full_access')
    expect(info.domains).toEqual(['acme.com', 'mail.acme.com'])
  })

  // Resend inverts the usual convention: 401 restricted_api_key means the key
  // is VALID but sending-only. Treating it as invalid (the Notion template's
  // "401/403 → bad token" shape) would reject every sending-only key.
  test('treats 401 restricted_api_key as a valid sending-access key, not a failure', async () => {
    stubFetch(401, {
      name: 'restricted_api_key',
      message: 'This API key is restricted to only send emails.',
    })
    const info = await verifyResendApiKey('re_sending_only')

    expect(info.permission).toBe('sending_access')
    expect(info.domains).toBeNull()
  })

  test('rejects a genuinely bad key (403 invalid_api_key)', async () => {
    stubFetch(403, { name: 'invalid_api_key', message: 'API key is invalid.' })
    const err = await verifyResendApiKey('re_bad').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ResendApiError)
    expect((err as ResendApiError).status).toBe(403)
    expect((err as ResendApiError).code).toBe('invalid_api_key')
  })

  // A 401 that isn't the restricted marker must not be silently downgraded to
  // "sending access" — that would hand the agent a key that cannot send either.
  test('does not mistake a non-restricted 401 for a sending-access key', async () => {
    stubFetch(401, { name: 'missing_api_key', message: 'Missing API key.' })
    const err = await verifyResendApiKey('').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ResendApiError)
    expect((err as ResendApiError).code).toBe('missing_api_key')
  })

  test('surfaces the API message on unexpected errors', async () => {
    stubFetch(500, { name: 'internal_server_error', message: 'Something went wrong.' })
    const err = await verifyResendApiKey('re_x').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ResendApiError)
    expect((err as ResendApiError).status).toBe(500)
    expect((err as ResendApiError).message).toContain('Something went wrong.')
  })
})
