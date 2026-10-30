import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requestFocus, takeFocus } from './focusRequest.ts'

test('a focus request waits for its object, then is taken once', () => {
  requestFocus('d1', 'f1')

  assert.equal(
    takeFocus('d1', () => false),
    null,
  )
  assert.equal(
    takeFocus('d2', () => true),
    null,
  )
  assert.equal(
    takeFocus('d1', (id) => id === 'f1'),
    'f1',
  )
  assert.equal(
    takeFocus('d1', () => true),
    null,
  )
})
