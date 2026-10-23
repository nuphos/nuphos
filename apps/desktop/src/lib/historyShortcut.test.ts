import assert from 'node:assert/strict'
import { test } from 'node:test'

import { historyShortcut } from './historyShortcut.ts'

type Mods = Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>>
const press = (code: string, mods: Mods) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

test('⌘[ / ⌘] step history on macOS', () => {
  assert.equal(historyShortcut(press('BracketLeft', { metaKey: true }), true), -1)
  assert.equal(historyShortcut(press('BracketRight', { metaKey: true }), true), 1)
  // ⇧⌘[ / ⇧⌘] stay previous / next tab, and ⌃[ stays a terminal's Esc.
  assert.equal(historyShortcut(press('BracketLeft', { metaKey: true, shiftKey: true }), true), null)
  assert.equal(historyShortcut(press('BracketLeft', { ctrlKey: true }), true), null)
  assert.equal(historyShortcut(press('ArrowLeft', { altKey: true }), true), null)
})

test('Alt+← / Alt+→ step history elsewhere, leaving Ctrl+[ to the terminal', () => {
  assert.equal(historyShortcut(press('ArrowLeft', { altKey: true }), false), -1)
  assert.equal(historyShortcut(press('ArrowRight', { altKey: true }), false), 1)
  assert.equal(historyShortcut(press('BracketLeft', { ctrlKey: true }), false), null)
  assert.equal(historyShortcut(press('ArrowLeft', { altKey: true, ctrlKey: true }), false), null)
})
