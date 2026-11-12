import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pinBeforeAt, previewPinOrder, pinGridColumns } from './bot-pin-order.ts'

test('default sidebar fits three compact centered pins', () => {
  assert.equal(pinGridColumns(248 - 20), 3)
  assert.equal(pinGridColumns(220 - 20), 2)
  assert.equal(pinGridColumns(380 - 20), 3)
})
test('row-first drop positions support insertion, append and a stable dragged placeholder', () => {
  const boxes = [
    { key: 'a', left: 0, top: 0, width: 68, height: 80 },
    { key: 'b', left: 72, top: 0, width: 68, height: 80 },
    { key: 'c', left: 144, top: 0, width: 68, height: 80 },
  ]

  assert.equal(pinBeforeAt(boxes, 'new', 80, 40), 'b')
  assert.equal(pinBeforeAt(boxes, 'new', 205, 40), null)
  assert.equal(pinBeforeAt(boxes, 'b', 100, 40), undefined)
})
test('preview inserts the actual bot before release and reordering does not duplicate it', () => {
  const a = { key: 'a' },
    b = { key: 'b' },
    c = { key: 'c' }

  assert.deepEqual(previewPinOrder([a, b], c, 'a'), [c, a, b])
  assert.deepEqual(previewPinOrder([a, b, c], c, 'b'), [a, c, b])
  assert.deepEqual(previewPinOrder([a, b, c], c, undefined), [a, b, c])
  assert.deepEqual(previewPinOrder([a, b], c, null), [a, b, c])
})
