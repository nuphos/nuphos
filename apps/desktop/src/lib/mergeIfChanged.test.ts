import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeIfChanged } from './mergeIfChanged.ts'

test('a refetch that changed nothing keeps the previous map identity', () => {
  const prev = { t1: { aws: [{ id: 'a' }], gcp: [] } }
  const next = JSON.parse(JSON.stringify(prev.t1))

  assert.equal(mergeIfChanged(prev, 't1', next), prev)
})

test('a real change swaps the entry and the map', () => {
  const prev = { t1: { aws: [] } }
  const out = mergeIfChanged(prev, 't1', { aws: [{ id: 'a' }] })

  assert.notEqual(out, prev)
  assert.deepEqual(out.t1, { aws: [{ id: 'a' }] })
})

test('a new key is added', () => {
  const out = mergeIfChanged({}, 't1', [1, 2])

  assert.deepEqual(out, { t1: [1, 2] })
})

test('other keys survive a merge', () => {
  const prev = { t1: [1], t2: [2] }
  const out = mergeIfChanged(prev, 't1', [9])

  assert.deepEqual(out, { t1: [9], t2: [2] })
})
