import assert from 'node:assert/strict'
import { test } from 'node:test'

import { historyShortcut } from './historyShortcut.ts'

const input = (
  code: string,
  mods: Partial<Record<'meta' | 'control' | 'alt' | 'shift', boolean>>,
) => ({
  code,
  meta: false,
  control: false,
  alt: false,
  shift: false,
  ...mods,
})

test('⌘[ / ⌘] step history on macOS', () => {
  assert.equal(historyShortcut(input('BracketLeft', { meta: true }), true), 'history-back')
  assert.equal(historyShortcut(input('BracketRight', { meta: true }), true), 'history-forward')
  // ⇧⌘[ / ⇧⌘] stay previous / next tab, and ⌃[ stays a terminal's Esc.
  assert.equal(historyShortcut(input('BracketLeft', { meta: true, shift: true }), true), null)
  assert.equal(historyShortcut(input('BracketLeft', { control: true }), true), null)
  assert.equal(historyShortcut(input('ArrowLeft', { alt: true }), true), null)
})

test('Alt+← / Alt+→ step history elsewhere, leaving Ctrl+[ to the terminal', () => {
  assert.equal(historyShortcut(input('ArrowLeft', { alt: true }), false), 'history-back')
  assert.equal(historyShortcut(input('ArrowRight', { alt: true }), false), 'history-forward')
  assert.equal(historyShortcut(input('BracketLeft', { control: true }), false), null)
  assert.equal(historyShortcut(input('ArrowLeft', { alt: true, control: true }), false), null)
})
