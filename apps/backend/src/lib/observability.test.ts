import { describe, expect, test } from 'bun:test'

import { UptimeKumaApiError } from '@/lib/byos/uptime-kuma'
import { describeUnknown, errorMessage, normalizeError } from '@/lib/observability'

// The strings these build become `AppError` messages, and `errorHandler` puts
// an AppError message straight in the response body. A rejection payload from
// an upstream SDK is arbitrary JSON, so anything credential-shaped in it has to
// be masked before it is described.
describe('describeUnknown does not leak credential-keyed properties', () => {
  test('masks secret-looking keys on a plain rejection payload', () => {
    const described = describeUnknown({ region: 'ap-east-1', accessKeySecret: 'AKIAsecretvalue' })

    expect(described).not.toContain('AKIAsecretvalue')
    expect(described).toContain('[REDACTED]')
    // Non-secret fields stay readable — masking must not cost diagnosability.
    expect(described).toContain('ap-east-1')
  })

  test('masks nested secret-looking keys', () => {
    const described = describeUnknown({
      response: { status: 401, headers: { authorization: 'Bearer live-token-value' } },
    })

    expect(described).not.toContain('live-token-value')
    expect(described).toContain('[REDACTED]')
    expect(described).toContain('401')
  })

  test('leaves payloads with nothing secret in them alone', () => {
    expect(describeUnknown({ ok: false, msg: 'monitor not found' })).toBe(
      '{"ok":false,"msg":"monitor not found"}',
    )
  })

  test('describes an Error by its message rather than as "{}"', () => {
    expect(describeUnknown(new Error('socket hang up'))).toBe('socket hang up')
    const blank = new RangeError('placeholder')

    blank.message = ''
    expect(describeUnknown(blank)).toBe('RangeError')
  })

  test('still describes primitives verbatim', () => {
    expect(describeUnknown(null)).toBe('null')
    expect(describeUnknown(undefined)).toBe('undefined')
    expect(describeUnknown('plain')).toBe('plain')
    expect(describeUnknown(42)).toBe('42')
    expect(describeUnknown([1, 2, 3])).toBe('[1,2,3]')
  })
})

describe('the client-visible error paths inherit the masking', () => {
  // uptime-kuma.ts wraps a non-Error socket rejection exactly this way, and the
  // routes turn that message into AppError(502, 'uptime_kuma_api_error', msg).
  test('an UptimeKumaApiError built from a rejection payload carries no credential', () => {
    const credential = 'hunter2-live'
    const rejection = { ok: false, password: credential, msg: 'auth failed' }
    const err = new UptimeKumaApiError(502, describeUnknown(rejection))

    expect(err.message).not.toContain(credential)
    expect(err.message).toContain('auth failed')
  })

  // The BYOS permission probes surface `upstreamMessage: errorMessage(denied)`
  // in AppError details; `denied` is whatever the cloud SDK rejected with.
  test('errorMessage masks when it falls back to describing a raw object', () => {
    const described = errorMessage({ code: 'Forbidden', secretAccessKey: 'zz-live-key' })

    expect(described).not.toContain('zz-live-key')
    expect(described).toContain('Forbidden')
  })

  test('errorMessage still prefers a plain message field', () => {
    expect(errorMessage({ message: 'RAM user has no permission' })).toBe(
      'RAM user has no permission',
    )
  })
})

describe('normalizeError keeps telemetry free of credential-keyed values', () => {
  test('a non-Error object with a secret key is masked in error_message', () => {
    const normalized = normalizeError({ status: 403, apiKey: 'sk-live-abc123' })

    expect(JSON.stringify(normalized)).not.toContain('sk-live-abc123')
    expect(normalized.error_status).toBe(403)
  })
})
