import assert from 'node:assert/strict'
import { test } from 'node:test'

import { floatingEdge, shown } from './summaryPlacement.ts'

const pane = { left: 200, width: 500 }

test('a floating panel opens end-aligned under a toggle on the right of the pane', () => {
  assert.deepEqual(floatingEdge({ left: 660, right: 688 }, pane, 1000), { right: 312 })
})

test('a floating panel opens start-aligned under a toggle on the left, as a Bot name is', () => {
  assert.deepEqual(floatingEdge({ left: 236, right: 380 }, pane, 1000), { left: 236 })
})

test("a pane's toggle is the one on screen, not a hidden kept-alive chat's before it", () => {
  const hidden = { offsetHeight: 0 } as HTMLElement
  const onScreen = { offsetHeight: 28 } as HTMLElement
  const root = { querySelectorAll: () => [hidden, onScreen] } as unknown as ParentNode

  assert.equal(shown(root, '[data-summary-toggle]'), onScreen)
  assert.equal(shown({ querySelectorAll: () => [hidden] } as unknown as ParentNode, 'x'), undefined)
})
