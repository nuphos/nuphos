import assert from 'node:assert/strict'
import { test } from 'node:test'

import { titlebarFit } from './titlebarFit.ts'

// A pane header's content width: the pane's share of a 1,480px window, less
// 12px of left padding and 48px kept for the dock toggle.
const paneOf = (panes: number) => Math.floor(1480 / panes) - 60

test('a header keeps every control while the pane has room', () => {
  assert.equal(titlebarFit(1420), 'full')
  assert.equal(titlebarFit(paneOf(3)), 'full')
  assert.equal(titlebarFit(paneOf(4)), 'full')
})

test('narrow panes drop the Share label first, then move the summary toggle into ⋯', () => {
  assert.equal(titlebarFit(paneOf(5)), 'compact')
  assert.equal(titlebarFit(paneOf(6)), 'tight')
  assert.equal(titlebarFit(0), 'tight')
})
