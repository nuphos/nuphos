import { createHash } from 'node:crypto'

import { expect, test } from 'bun:test'

import { verifyLarkSignature } from './api-core'

const encryptKey = 'k'
const rawBody = '{"event":1}'
const nonce = 'n'

function signed(timestampSec: number) {
  const timestamp = String(timestampSec)
  const signature = createHash('sha256')
    .update(timestamp + nonce + encryptKey + rawBody)
    .digest('hex')

  return { encryptKey, rawBody, nonce, timestamp, signature }
}

const NOW = 1_800_000_000_000

test('accepts a correctly signed event inside the window', () => {
  expect(verifyLarkSignature({ ...signed(NOW / 1000 - 60), now: NOW })).toBe(true)
})

test('refuses a correctly signed event replayed after the window', () => {
  expect(verifyLarkSignature({ ...signed(NOW / 1000 - 6 * 60), now: NOW })).toBe(false)
  expect(verifyLarkSignature({ ...signed(Number.NaN), now: NOW })).toBe(false)
})
