import assert from 'node:assert/strict'
import { test } from 'node:test'

import { floatingEdge } from './summaryPlacement.ts'

const pane = { left: 200, width: 500 }

test('a floating panel opens end-aligned under a toggle on the right of the pane', () => {
  assert.deepEqual(floatingEdge({ left: 660, right: 688 }, pane, 1000), { right: 312 })
})

test('a floating panel opens start-aligned under a toggle on the left, as a Bot name is', () => {
  assert.deepEqual(floatingEdge({ left: 236, right: 380 }, pane, 1000), { left: 236 })
})
