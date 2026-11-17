import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sidebarShortcutAction } from './sidebar-shortcuts.ts'

const input = {
  key: '2',
  code: 'Digit2',
  control: true,
  meta: false,
  alt: false,
  shift: false,
  isComposing: false,
}

test('native sidebar shortcuts are routed before workspace tab shortcuts', () => {
  assert.equal(sidebarShortcutAction(input, true), 'select-sidebar-tab-2')
  assert.equal(sidebarShortcutAction({ ...input, control: false, meta: true }, true), null)
  assert.equal(
    sidebarShortcutAction({ ...input, control: false, alt: true }, false),
    'select-sidebar-tab-2',
  )
  assert.equal(sidebarShortcutAction(input, false), null)
})

test('native sidebar shortcuts reject extra modifiers and composition', () => {
  for (const extra of [
    { shift: true },
    { meta: true },
    { alt: true },
    { isComposing: true },
    { key: '4' },
  ]) {
    assert.equal(sidebarShortcutAction({ ...input, ...extra }, true), null)
  }
})
