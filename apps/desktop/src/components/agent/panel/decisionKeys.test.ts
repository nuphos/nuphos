import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decisionKey } from './decisionKeys.ts'

const press = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  ...mods,
})

test('⌘↵ approves and ⌘⌫ denies on macOS; Ctrl stands in elsewhere', () => {
  assert.deepEqual(decisionKey(press('Enter', 'Enter', { metaKey: true }), true, false), {
    kind: 'approve',
  })
  assert.deepEqual(decisionKey(press('Backspace', 'Backspace', { metaKey: true }), true, false), {
    kind: 'deny',
  })
  assert.deepEqual(decisionKey(press('Enter', 'Enter', { ctrlKey: true }), false, false), {
    kind: 'approve',
  })
  // ⌃↵ on macOS and ⌘↵ elsewhere are not the shortcut.
  assert.equal(decisionKey(press('Enter', 'Enter', { ctrlKey: true }), true, false), null)
  assert.equal(decisionKey(press('Enter', 'Enter', { metaKey: true }), false, false), null)
})

test('⌘⌫ keeps deleting while the focused box holds text', () => {
  assert.equal(decisionKey(press('Backspace', 'Backspace', { metaKey: true }), true, true), null)
  assert.deepEqual(decisionKey(press('Enter', 'Enter', { metaKey: true }), true, true), {
    kind: 'approve',
  })
})

test('⌥⌘1–⌥⌘9 pick an option by physical key', () => {
  const pick = { altKey: true, metaKey: true }

  assert.deepEqual(decisionKey(press('¡', 'Digit1', pick), true, true), {
    kind: 'option',
    index: 0,
  })
  assert.deepEqual(decisionKey(press('ª', 'Digit9', pick), true, false), {
    kind: 'option',
    index: 8,
  })
  assert.equal(decisionKey(press('º', 'Digit0', pick), true, false), null)
})

test('⌥ digits alone stay characters, e.g. ⌥5 is [ on a German Mac layout', () => {
  assert.equal(decisionKey(press('[', 'Digit5', { altKey: true }), true, true), null)
  assert.equal(decisionKey(press('[', 'Digit5', { altKey: true }), true, false), null)
})

test('off macOS Ctrl+Alt+digit picks only when it still reads as the digit (not AltGr)', () => {
  const pick = { altKey: true, ctrlKey: true }

  assert.deepEqual(decisionKey(press('2', 'Digit2', pick), false, false), {
    kind: 'option',
    index: 1,
  })
  assert.equal(decisionKey(press('{', 'Digit7', pick), false, false), null)
})

test('plain Enter, ⇧ variants and IME composition are left alone', () => {
  assert.equal(decisionKey(press('Enter', 'Enter'), true, false), null)
  assert.equal(
    decisionKey(press('Enter', 'Enter', { metaKey: true, shiftKey: true }), true, false),
    null,
  )
  assert.equal(
    decisionKey(press('Enter', 'Enter', { metaKey: true, isComposing: true }), true, false),
    null,
  )
})
