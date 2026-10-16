import assert from 'node:assert/strict'
import { test } from 'node:test'

import { comboParts } from './platform.ts'
import {
  matchSessionShortcut,
  SESSION_SHORTCUTS,
  sessionShortcutCombo,
} from './sessionShortcuts.ts'

import type { ShortcutInput } from './sessionShortcuts.ts'

const none = { meta: false, control: false, alt: false, shift: false, isComposing: false }

function press(code: string, key: string, mods: Partial<ShortcutInput>): ShortcutInput {
  return { ...none, code, key, ...mods }
}

test('macOS ⌥⌘ combos match by physical key, ignoring the composed character', () => {
  assert.equal(
    matchSessionShortcut(press('KeyR', '®', { meta: true, alt: true }), true),
    'rename-chat',
  )
  assert.equal(
    matchSessionShortcut(press('KeyP', 'π', { meta: true, alt: true }), true),
    'toggle-pin-chat',
  )
})

test('macOS ⇧⌘ combos', () => {
  assert.equal(
    matchSessionShortcut(press('KeyA', 'A', { meta: true, shift: true }), true),
    'archive-chat',
  )
  assert.equal(
    matchSessionShortcut(press('KeyC', 'C', { meta: true, shift: true }), true),
    'copy-chat-link',
  )
})

test('modifiers must match exactly', () => {
  // ⌘C copy, ⌘A select all, ⌘R reload stay untouched.
  assert.equal(matchSessionShortcut(press('KeyC', 'c', { meta: true }), true), null)
  assert.equal(matchSessionShortcut(press('KeyA', 'a', { meta: true }), true), null)
  assert.equal(matchSessionShortcut(press('KeyR', 'r', { meta: true }), true), null)
  assert.equal(
    matchSessionShortcut(press('KeyA', 'A', { meta: true, shift: true, alt: true }), true),
    null,
  )
  assert.equal(
    matchSessionShortcut(press('KeyR', '®', { meta: true, alt: true, shift: true }), true),
    null,
  )
  // ⌃ is not mod on macOS, and ⌃⌘ is a different combo.
  assert.equal(matchSessionShortcut(press('KeyA', 'A', { control: true, shift: true }), true), null)
  assert.equal(
    matchSessionShortcut(press('KeyA', 'A', { meta: true, control: true, shift: true }), true),
    null,
  )
  assert.equal(matchSessionShortcut(press('KeyR', 'r', { alt: true }), true), null)
})

test('Ctrl is mod off macOS', () => {
  assert.equal(
    matchSessionShortcut(press('KeyR', 'r', { control: true, alt: true }), false),
    'rename-chat',
  )
  assert.equal(
    matchSessionShortcut(press('KeyA', 'A', { control: true, shift: true }), false),
    'archive-chat',
  )
  assert.equal(matchSessionShortcut(press('KeyA', 'A', { meta: true, shift: true }), false), null)
})

test('copy link has no shortcut off macOS, so Ctrl+Shift+C stays copy', () => {
  assert.equal(
    matchSessionShortcut(press('KeyC', 'C', { control: true, shift: true }), false),
    null,
  )
  assert.equal(sessionShortcutCombo('copy-chat-link', false), '')
  assert.equal(sessionShortcutCombo('copy-chat-link', true), 'mod+shift+c')
})

test('a key pressed while an IME is composing is not a shortcut', () => {
  assert.equal(
    matchSessionShortcut(press('KeyA', 'A', { meta: true, shift: true, isComposing: true }), true),
    null,
  )
})

test('AltGr text input off macOS is not a shortcut', () => {
  // Some layouts type ¶ with AltGr+R.
  assert.equal(matchSessionShortcut(press('KeyR', '¶', { control: true, alt: true }), false), null)
  assert.equal(
    matchSessionShortcut(press('KeyP', 'P', { control: true, alt: true }), false),
    'toggle-pin-chat',
  )
})

test('every combo is unique and renders', () => {
  const combos = SESSION_SHORTCUTS.map((shortcut) => shortcut.combo)

  assert.equal(new Set(combos).size, combos.length)
  assert.deepEqual(comboParts(sessionShortcutCombo('rename-chat', true), true), ['⌘', '⌥', 'R'])
  assert.deepEqual(comboParts(sessionShortcutCombo('archive-chat', false), false), [
    'Ctrl',
    'Shift',
    'A',
  ])
})
