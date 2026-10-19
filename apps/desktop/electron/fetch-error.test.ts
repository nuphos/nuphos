import assert from 'node:assert/strict'
import { test } from 'node:test'

import { backendFailure, describeFetchError, tagRequest } from './fetch-error.ts'

function undiciFetchFailed(cause: unknown): TypeError {
  return new TypeError('fetch failed', { cause })
}

test('a socket closed under a request names the code and both ends of the socket', () => {
  /* eslint-disable sonarjs/no-hardcoded-ip -- socket fixture; no network request */
  const cause = Object.assign(new Error('other side closed'), {
    name: 'SocketError',
    code: 'UND_ERR_SOCKET',
    socket: {
      localAddress: '198.18.0.1',
      localPort: 63507,
      remoteAddress: '172.67.147.68',
      remotePort: 443,
      bytesWritten: 812,
      bytesRead: 0,
    },
  })
  /* eslint-enable sonarjs/no-hardcoded-ip */

  assert.equal(
    describeFetchError(undiciFetchFailed(cause)),
    'fetch failed (UND_ERR_SOCKET: other side closed local=198.18.0.1:63507 remote=172.67.147.68:443 written=812 read=0)',
  )
})

test('an empty-message AggregateError lists every address that failed to connect', () => {
  const cause = Object.assign(
    new AggregateError(
      [
        Object.assign(new Error('connect ETIMEDOUT 104.21.65.167:443'), { code: 'ETIMEDOUT' }),
        Object.assign(new Error('connect ETIMEDOUT 172.67.147.68:443'), { code: 'ETIMEDOUT' }),
      ],
      // eslint-disable-next-line unicorn/error-message -- undici's happy-eyeballs error really has none
      '',
    ),
    { code: 'ETIMEDOUT' },
  )

  assert.equal(
    describeFetchError(undiciFetchFailed(cause)),
    'fetch failed (ETIMEDOUT [connect ETIMEDOUT 104.21.65.167:443; connect ETIMEDOUT 172.67.147.68:443])',
  )
})

test('a failure without a cause keeps its own message', () => {
  assert.equal(describeFetchError(new Error('Not signed in')), 'Not signed in')
})

const REQUEST_ID = '1bb8abcb-5d2e-4a8f-9c41-0f3e7d6a2b10'

function visible(error: unknown): string {
  return (backendFailure(error, '/teams/t/connectors', REQUEST_ID) as Error).message
}

test('the visible failure is the reason and the trace id, without addresses or byte counts', () => {
  /* eslint-disable sonarjs/no-hardcoded-ip -- socket fixture; no network request */
  const cause = Object.assign(new Error('other side closed'), {
    code: 'UND_ERR_SOCKET',
    socket: { localAddress: '198.18.0.1', localPort: 63507, bytesWritten: 812, bytesRead: 0 },
  })
  /* eslint-enable sonarjs/no-hardcoded-ip */

  assert.equal(
    visible(undiciFetchFailed(cause)),
    'Nuphos backend request failed: other side closed (trace 1bb8abcb…)',
  )
})

test('a system error reads as its syscall and code, not its address', () => {
  const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), {
    code: 'ECONNREFUSED',
    syscall: 'connect',
  })

  assert.equal(
    visible(undiciFetchFailed(cause)),
    'Nuphos backend request failed: connect ECONNREFUSED (trace 1bb8abcb…)',
  )
})

test('an empty-message AggregateError reads as its first sub-error', () => {
  const cause = new AggregateError(
    [
      Object.assign(new Error('connect ETIMEDOUT 104.21.65.167:443'), {
        code: 'ETIMEDOUT',
        syscall: 'connect',
      }),
    ],
    // eslint-disable-next-line unicorn/error-message -- undici's happy-eyeballs error really has none
    '',
  )

  assert.equal(
    visible(undiciFetchFailed(cause)),
    'Nuphos backend request failed: connect ETIMEDOUT (trace 1bb8abcb…)',
  )
})

test("undici's connect timeout drops its attempted addresses", () => {
  const cause = Object.assign(
    new Error('Connect Timeout Error (attempted addresses: 52.9.93.56:443, timeout: 10000ms)'),
    { code: 'UND_ERR_CONNECT_TIMEOUT' },
  )

  assert.equal(
    visible(undiciFetchFailed(cause)),
    'Nuphos backend request failed: Connect Timeout Error (trace 1bb8abcb…)',
  )
})

test('the failure keeps the original error as its cause for the log', () => {
  const original = undiciFetchFailed(new Error('self-signed certificate'))

  assert.equal((backendFailure(original, '/x', REQUEST_ID) as Error).cause, original)
})

test('aborts pass through untouched so cancel handling still recognises them', () => {
  const abort = new DOMException('This operation was aborted', 'AbortError')

  assert.equal(backendFailure(abort, '/x', REQUEST_ID), abort)
})

test('a tagged request sends the id the backend adopts as its request id', () => {
  const headers: Record<string, string> = {}
  const requestId = tagRequest(headers)

  assert.equal(headers['x-request-id'], requestId)
  assert.match(requestId, /^[\w-]+$/)
})
