import assert from 'node:assert/strict'
import { test } from 'node:test'

import { opensRowMenu, rowMenuAnchor } from './row-menu.ts'

test('Enter and Space open the row menu', () => {
  assert.equal(opensRowMenu('Enter'), true)
  assert.equal(opensRowMenu(' '), true)
})

test('other keys leave the row menu closed', () => {
  for (const key of ['Escape', 'Tab', 'ArrowDown', 'a', 'Spacebar', 'F10']) {
    assert.equal(opensRowMenu(key), false, key)
  }
})

test('the row menu opens under the button, at its left edge', () => {
  assert.deepEqual(rowMenuAnchor({ left: 240, bottom: 118 }), { clientX: 240, clientY: 118 })
})
