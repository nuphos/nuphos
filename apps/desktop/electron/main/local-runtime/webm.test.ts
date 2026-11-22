import assert from 'node:assert/strict'
import { test } from 'node:test'

import { webm } from './webm.ts'

const frame = (ms: number, key: boolean) => ({ ms, key, data: Buffer.from('VP8') })

test('a WebM lasts as long as it was recorded, with a cluster and a cue at every key frame', () => {
  const bytes = webm(
    [frame(0, true), frame(40, false), frame(2000, true)],
    { width: 1440, height: 900 },
    2500,
  )
  const count = (id: string) => bytes.toString('hex').split(id).length - 1

  assert.equal(bytes.subarray(0, 4).toString('hex'), '1a45dfa3')
  // The duration, 2500 ms as a double.
  assert.ok(bytes.includes(Buffer.from('40a3880000000000', 'hex')))
  assert.equal(count('1f43b675'), 2)
  assert.equal(count('bb01'), 2)
  // The frame at 40 ms is 40 ms into the first cluster, and not a key frame.
  assert.ok(bytes.includes(Buffer.from('81002800565038', 'hex')))
})
