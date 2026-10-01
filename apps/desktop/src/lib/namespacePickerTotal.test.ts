import assert from 'node:assert/strict'
import test from 'node:test'

import { namespacePickerTotals } from './namespacePickerTotal.ts'

test('names the real total when the server reports one', () => {
  // The measured cluster: 500 fetched, 38,728 remaining.
  assert.deepEqual(
    namespacePickerTotals({ fetched: 500, continueToken: 'abc', remainingItemCount: 38728 }),
    { truncated: true, total: 39228 },
  )
})

test('still reports truncation when remainingItemCount is omitted', () => {
  // remainingItemCount is optional per the API conventions. Losing truncation
  // here would present a 500-of-39,228 list as the entire cluster.
  assert.deepEqual(namespacePickerTotals({ fetched: 500, continueToken: 'abc' }), {
    truncated: true,
    total: null,
  })
  assert.deepEqual(
    namespacePickerTotals({ fetched: 500, continueToken: 'abc', remainingItemCount: null }),
    { truncated: true, total: null },
  )
})

test('a single-page list is not truncated', () => {
  assert.deepEqual(namespacePickerTotals({ fetched: 12, continueToken: null }), {
    truncated: false,
    total: null,
  })
})

test('ignores a count the server sent without a continue token', () => {
  // No continue token means this page IS the list; a stray count must not
  // invent a larger cluster.
  assert.deepEqual(
    namespacePickerTotals({ fetched: 12, continueToken: '', remainingItemCount: 99 }),
    { truncated: false, total: null },
  )
})
