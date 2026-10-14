import assert from 'node:assert/strict'
import { test } from 'node:test'

import { linkClickMode } from './linkClickMode.ts'

const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

test('a plain left click opens in place', () => {
  assert.equal(linkClickMode(plain, true), 'open')
  assert.equal(linkClickMode(plain, false), 'open')
})

test('Cmd on macOS and Ctrl elsewhere open beside', () => {
  assert.equal(linkClickMode({ ...plain, metaKey: true }, true), 'beside')
  assert.equal(linkClickMode({ ...plain, ctrlKey: true }, false), 'beside')
})

test('other modifiers and buttons stay with the browser', () => {
  assert.equal(linkClickMode({ ...plain, ctrlKey: true }, true), null)
  assert.equal(linkClickMode({ ...plain, metaKey: true }, false), null)
  assert.equal(linkClickMode({ ...plain, metaKey: true, ctrlKey: true }, true), null)
  assert.equal(linkClickMode({ ...plain, metaKey: true, shiftKey: true }, true), null)
  assert.equal(linkClickMode({ ...plain, altKey: true }, true), null)
  assert.equal(linkClickMode({ ...plain, button: 1 }, true), null)
})
