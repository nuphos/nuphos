import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sidebarShortcutPage } from './sidebar-shortcuts.ts'

const event = (key: string, modifiers = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  isComposing: false,
  repeat: false,
  ...modifiers,
})

test('sidebar shortcuts follow the current tab order on both platforms', () => {
  const order = [2, 0, 1] as const

  for (const mac of [true, false]) {
    for (const [index, page] of order.entries()) {
      assert.equal(
        sidebarShortcutPage(
          event(String(index + 1), mac ? { ctrlKey: true } : { altKey: true }),
          order,
          mac,
        ),
        page,
      )
    }
  }
})

test('sidebar shortcuts leave workspace shortcuts and modified or consumed keys alone', () => {
  const order = [0, 1, 2] as const

  for (const mac of [true, false]) {
    for (const modifiers of [
      {},
      { metaKey: true },
      { ctrlKey: true, altKey: true },
      { ctrlKey: true, shiftKey: true },
      { altKey: true, shiftKey: true },
      { ctrlKey: true, defaultPrevented: true },
      { altKey: true, isComposing: true },
    ]) {
      assert.equal(sidebarShortcutPage(event('1', modifiers), order, mac), undefined)
    }
    assert.equal(
      sidebarShortcutPage(event('4', mac ? { ctrlKey: true } : { altKey: true }), order, mac),
      undefined,
    )
  }
})
