import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findOffsets } from './findOffsets.ts'

test('finds every match regardless of case', () => {
  assert.deepEqual(findOffsets('Pod pod POD', 'pod'), [0, 4, 8])
})

test('treats regex metacharacters literally', () => {
  assert.deepEqual(findOffsets('a.b axb a.b', 'a.b'), [0, 8])
  assert.deepEqual(findOffsets('cost (usd) $5', '(usd) $'), [5])
})

test('keeps offsets aligned after characters whose lowercase is longer', () => {
  assert.deepEqual(findOffsets('İİ node', 'NODE'), [3])
})

test('returns nothing for an empty query', () => {
  assert.deepEqual(findOffsets('anything', ''), [])
})
