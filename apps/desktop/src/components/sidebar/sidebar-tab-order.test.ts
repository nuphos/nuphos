import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_TAB_ORDER,
  defaultPage,
  moveTab,
  pageBeside,
  parseTabOrder,
  serializeTabOrder,
  setSidebarTabOrder,
  sidebarTabOrder,
  slotOf,
  subscribeSidebarTabOrder,
} from './sidebar-tab-order.ts'

test('a saved order round-trips and anything malformed falls back to the default', () => {
  assert.deepEqual(parseTabOrder(serializeTabOrder([2, 0, 1])), [2, 0, 1])
  assert.equal(serializeTabOrder([1, 2, 0]), 'tasks,inbox,bots')
  for (const raw of [
    null,
    '',
    'bots,tasks',
    'bots,bots,tasks',
    'bots,tasks,inbox,bots',
    'a,b,c',
    7,
  ])
    assert.deepEqual(parseTabOrder(raw), DEFAULT_TAB_ORDER, String(raw))
})

test('moving a tab shifts its neighbours and clamps at the ends', () => {
  assert.deepEqual(moveTab([0, 1, 2], 0, 1), [1, 0, 2])
  assert.deepEqual(moveTab([0, 1, 2], 2, -2), [2, 0, 1])
  assert.deepEqual(moveTab([0, 1, 2], 0, 9), [1, 2, 0], 'End moves to the last slot')
  const order = [0, 1, 2] as const

  assert.equal(moveTab(order, 0, -1), order, 'nothing to move returns the same order')
})

test('arrow keys and the swipe track follow the order on screen', () => {
  const order = [2, 0, 1] as const

  assert.equal(slotOf(order, 2), 0)
  assert.equal(slotOf(order, 1), 2)
  assert.equal(pageBeside(order, 2, 1), 0, 'right of the Inbox is Bots')
  assert.equal(pageBeside(order, 1, 1), 1, 'the last tab stays put')
  assert.equal(pageBeside(order, 0, -9), 2, 'Home goes to the leftmost tab')
})

test('the default page is the leftmost chat list, never the Inbox', () => {
  assert.equal(defaultPage([0, 1, 2]), 0)
  assert.equal(defaultPage([1, 0, 2]), 1)
  assert.equal(defaultPage([2, 1, 0]), 1)
})

test('the order is remembered in storage and changes notify listeners once', () => {
  const saved: Record<string, string> = { 'nuphos.sidebar.tabOrder.v1': 'tasks,bots,inbox' }

  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => saved[key] ?? null,
      setItem: (key: string, value: string) => {
        saved[key] = value
      },
    },
    configurable: true,
  })
  let calls = 0
  const off = subscribeSidebarTabOrder(() => {
    calls += 1
  })

  assert.deepEqual(sidebarTabOrder(), [1, 0, 2])
  setSidebarTabOrder([2, 1, 0])
  setSidebarTabOrder([2, 1, 0])
  assert.equal(saved['nuphos.sidebar.tabOrder.v1'], 'inbox,tasks,bots')
  assert.equal(calls, 1, 'saving the same order again is a no-op')
  off()
})
