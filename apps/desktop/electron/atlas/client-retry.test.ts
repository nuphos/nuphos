import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

mock.module('../analytics.ts', { namedExports: { captureMain: () => {} } })
mock.module('../client-version.ts', {
  namedExports: { CLIENT_VERSION_HEADER: 'x-test', CLIENT_VERSION_VALUE: 'test' },
})

const { fetchWithRetry } = await import('./client.ts')

const account = {
  epoch: 0,
  api: 'https://a.example.test',
  token: 't',
  userId: 'u',
  signal: new AbortController().signal,
}

function failWith(error: Error) {
  let calls = 0

  mock.method(globalThis, 'fetch', () => {
    calls += 1

    return Promise.reject(error)
  })

  return () => calls
}

test('a quick connection failure is retried', async () => {
  const calls = failWith(new TypeError('net::ERR_NETWORK_CHANGED'))

  await assert.rejects(fetchWithRetry(account, '/x', {}))
  assert.equal(calls(), 3)
})

test('an attempt that used up its timeout is not retried', async () => {
  const calls = failWith(
    new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
  )

  await assert.rejects(fetchWithRetry(account, '/x', {}), { name: 'TimeoutError' })
  assert.equal(calls(), 1)
})
