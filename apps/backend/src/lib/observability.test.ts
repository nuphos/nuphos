import { describe, expect, spyOn, test } from 'bun:test'

import { UptimeKumaApiError } from '@/lib/byos/uptime-kuma'
import { OpenAbRpcError } from '@/lib/claude-code-preview/openab-acp-errors'
import { AppError } from '@/lib/errors'
import {
  describeUnknown,
  errorMessage,
  logError,
  logEvent,
  normalizeError,
} from '@/lib/observability'

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

describe('normalizeError names the runtime an error is about', () => {
  test('an offline runtime logs its runtime and device ids', () => {
    const offline = new AppError(409, 'runtime_offline', 'The computer is offline.', {
      runtimeId: 'runtime-1',
      deviceId: 'device-1',
      runtimeLabel: 'Claude Code in Mac',
    })

    expect(normalizeError(offline)).toMatchObject({
      provider_error_code: 'runtime_offline',
      runtime_id: 'runtime-1',
      device_id: 'device-1',
    })
  })
})

/** The JSON line `run` writes to stderr, parsed. */
function captureError(run: () => void): Record<string, unknown> {
  const spy = spyOn(console, 'error').mockImplementation(() => null)

  try {
    run()

    return JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>
  } finally {
    spy.mockRestore()
  }
}

// An upstream error can name a credential in its message, and the stack and
// cause repeat it. Every structured log line is masked where it is
// serialized, whichever field or nesting level the text arrives in.
describe('structured log lines carry no credential-shaped text', () => {
  // Synthetic fixture, not a real credential.
  const FAKE_KEY = 'tkey_0synthetic0fixture0only1'
  const AMZ_ID_2 = 'Uv8Xq3Lk9Zp2Rt6Wy1Bn4Mc7Df0Gh5Jk8Sa3Qe6Tr9Yu2Io5Pz/AbCdEfGhIjKlMnOp='

  function upstreamAuthError(): Error {
    const err = Object.assign(
      new Error(
        `API key ${FAKE_KEY} expired; create an API key at https://example.test/keys and send it as "Authorization: Bearer <key>"`,
        { cause: new Error(`rejected API key ${FAKE_KEY}`) },
      ),
      { status: 401, code: 'expired_key', retryable: false },
    )

    err.name = 'UpstreamAuthError'

    return err
  }

  test('message, stack and cause of a logged error are masked', () => {
    const line = captureError(() => {
      logError('agent.example.failed', upstreamAuthError(), {
        session_id: '2f1c7a4e-9b3d-4e8a-8c1f-5d6e7f8a9b0c',
        request_id: 'req_7Hc2LmQp',
        provider_request_id: AMZ_ID_2,
      })
    })

    expect(JSON.stringify(line)).not.toContain(FAKE_KEY)
    expect(line.error_message).toContain('API key [REDACTED:secret-phrase] expired')
    expect(line.error_stack).toContain('UpstreamAuthError: API key [REDACTED:secret-phrase]')
    expect(line.cause_message).toBe('rejected API key [REDACTED:secret-phrase]')
    // What an operator needs to act on the failure survives.
    expect(line).toMatchObject({
      error_name: 'UpstreamAuthError',
      error_status: 401,
      provider_error_code: 'expired_key',
      retryable: false,
      session_id: '2f1c7a4e-9b3d-4e8a-8c1f-5d6e7f8a9b0c',
      request_id: 'req_7Hc2LmQp',
      provider_request_id: AMZ_ID_2,
    })
  })

  test('an error nested in properties and a plain message string are masked', () => {
    const line = captureError(() => {
      logEvent('error', 'agent.example.failed', {
        upstream: upstreamAuthError(),
        error: `upstream said: API key ${FAKE_KEY} expired`,
      })
    })

    expect(JSON.stringify(line)).not.toContain(FAKE_KEY)
    expect(line.error).toBe('upstream said: API key [REDACTED:secret-phrase] expired')
  })

  test('ids and hashes in a message stay readable', () => {
    const message =
      'push of ba52879a65f80fe52db77d9df203b0f92f97afb1 for team 6a2360b039eaf6c10401d96e failed'
    const line = captureError(() => {
      logError('agent.example.failed', new Error(message))
    })

    expect(line.error_message).toBe(message)
  })
})

describe('long log strings', () => {
  const FAKE_KEY = 'tkey_0synthetic0fixture0only1'

  test('a key that crosses the truncation point is masked, not cut in half', () => {
    const line = captureError(() => {
      logEvent('error', 'agent.example.failed', {
        error: `${'x '.repeat(495)}API key ${FAKE_KEY} expired ${'y'.repeat(5_000_000)}`,
      })
    })

    expect(String(line.error)).not.toContain(FAKE_KEY.slice(0, 8))
    expect(String(line.error)).toEndWith('...')
  })
})

describe('request paths', () => {
  test('a path made of ids stays readable, so a log line still names its route', () => {
    const path = '/agent/conversations/fd843d8c-98f7-4290-b155-bd014bb2315c'
    const line = captureError(() => {
      logEvent('error', 'http.request', { path, status: 404 })
    })

    expect(line.path).toBe(path)
  })
})

describe('an agent out of usage', () => {
  test('is logged as a warning, while any other failure stays an error', () => {
    const outOfUsage = new OpenAbRpcError(
      "**Internal Error** (code: -32603)\nInternal error: You've hit your weekly limit · resets 4pm (UTC)",
      -32603,
    )
    const warn = spyOn(console, 'warn').mockImplementation(() => null)
    const error = spyOn(console, 'error').mockImplementation(() => null)

    try {
      logError('agent.example.failed', outOfUsage)
      logError('agent.example.failed', new Error('disk full'))

      expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ level: 'warn' })
      expect(error.mock.calls).toHaveLength(1)
      expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({ level: 'error' })
    } finally {
      warn.mockRestore()
      error.mockRestore()
    }
  })
})
