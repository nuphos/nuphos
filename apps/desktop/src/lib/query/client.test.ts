import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createQueryClient, retryRead } from './client.ts'

const refusal = (code: string) =>
  new Error(`__ATLAS_API_ERROR__${JSON.stringify({ message: 'Refused', code })}`)

test('a read that got no answer is tried once more, then given up', () => {
  const offline = new Error("Error invoking remote method 'atlas:x': Error: fetch failed")

  assert.equal(retryRead(0, offline), true)
  assert.equal(retryRead(1, offline), false)
})

test('a refusal the backend wrote is not asked again', () => {
  assert.equal(retryRead(0, refusal('not_found')), false)
  assert.equal(retryRead(0, refusal('forbidden')), false)
  assert.equal(retryRead(0, refusal('internal_error')), false)
})

test('a rejected session, a switched account or a timeout is not retried', () => {
  assert.equal(retryRead(0, refusal('unauthorized')), false)
  assert.equal(retryRead(0, new Error('AccountChangedError: switched')), false)
  assert.equal(retryRead(0, new Error('This operation was aborted due to timeout')), false)
  assert.equal(retryRead(0, new Error('Connect Timeout Error (timeout: 10000ms)')), false)
})

test('a write is never retried and a hidden window does not poll', () => {
  const defaults = createQueryClient().getDefaultOptions()

  assert.equal(defaults.mutations?.retry, false)
  assert.equal(defaults.queries?.refetchIntervalInBackground, false)
})
