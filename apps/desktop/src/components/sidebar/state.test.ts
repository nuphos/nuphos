import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { nestItems } from './nest-items.ts'
import { loadGroupState, subscribeGroupState, writeGroupFold } from './state.ts'

const values = new Map<string, string>()

Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  },
  window: new EventTarget(),
})

beforeEach(() => values.clear())

const TEAM = 'team-a'
const PARENT = 'agent-session:parent'
const isFolded = (key: string) => loadGroupState(TEAM)[key] === 'closed'
const visibleKeys = (items: { key: string; parentKey?: string }[]) =>
  nestItems(items, isFolded).map(({ item }) => item.key)

const parentWithThread = [{ key: PARENT }, { key: 'agent-session:a', parentKey: PARENT }]

test('a toggle writes only its own entry, so a window that never saw a fold cannot reopen it', () => {
  // Window B mounts before window A folds the parent; B's later toggle of an
  // unrelated group used to write B's whole older copy back over A's fold.
  writeGroupFold(TEAM, PARENT, 'closed')
  writeGroupFold(TEAM, 'Chats', 'closed')
  writeGroupFold('team-b', PARENT, 'open')

  assert.deepEqual(loadGroupState(TEAM), { [PARENT]: 'closed', Chats: 'closed' })
})

test('every reader is told about a fold change', () => {
  let calls = 0
  const unsubscribe = subscribeGroupState(() => calls++)

  writeGroupFold(TEAM, PARENT, 'closed')
  unsubscribe()
  writeGroupFold(TEAM, PARENT, 'open')

  assert.equal(calls, 1)
})

test('a folded parent stays folded across everything except its own toggle', () => {
  writeGroupFold(TEAM, PARENT, 'closed')
  const triggers: Record<string, { key: string; parentKey?: string }[]> = {
    'a new thread created under it': [
      ...parentWithThread,
      { key: 'agent-session:b', parentKey: PARENT },
    ],
    'its thread opened, running or unread (fresh row objects)': parentWithThread.map((row) => ({
      ...row,
      active: true,
    })),
    'a list refresh that reorders rows': [...parentWithThread].reverse(),
    'its threads gone for a refresh, then back': [{ key: PARENT }],
    'it moved to Pinned (same row key)': [{ key: 'pinned-page' }, ...parentWithThread],
  }

  for (const [trigger, items] of Object.entries(triggers)) {
    assert.ok(
      !visibleKeys(items).some((key) => items.find((row) => row.key === key)?.parentKey),
      trigger,
    )
  }
  // A remount, a team switch and back, or a restart all re-read storage.
  assert.deepEqual(loadGroupState('team-b'), {})
  assert.deepEqual(visibleKeys(parentWithThread), [PARENT])

  writeGroupFold(TEAM, PARENT, 'open')
  assert.deepEqual(visibleKeys(parentWithThread), [PARENT, 'agent-session:a'])
})
