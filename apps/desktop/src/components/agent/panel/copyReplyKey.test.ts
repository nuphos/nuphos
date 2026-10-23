import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isCopyReplyKey } from './copyReplyKey.ts'

const press = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
  key,
  code: 'KeyC',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  ...mods,
})

test('⌥⌘C copies on macOS whatever character ⌥ composes', () => {
  assert.equal(isCopyReplyKey(press('ç', { metaKey: true, altKey: true }), true), true)
  assert.equal(isCopyReplyKey(press('c', { metaKey: true }), true), false)
  assert.equal(isCopyReplyKey(press('ç', { altKey: true }), true), false)
  assert.equal(
    isCopyReplyKey(press('Ç', { metaKey: true, altKey: true, shiftKey: true }), true),
    false,
  )
})

test('Ctrl+Alt+C copies elsewhere, but not when AltGr+C types another character', () => {
  assert.equal(isCopyReplyKey(press('c', { ctrlKey: true, altKey: true }), false), true)
  assert.equal(isCopyReplyKey(press('©', { ctrlKey: true, altKey: true }), false), false)
})
