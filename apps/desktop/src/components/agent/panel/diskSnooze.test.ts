import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  covers,
  dismissal,
  dismissDisk,
  diskSnoozed,
  resetDiskSnooze,
  subscribeDiskSnooze,
} from './diskSnooze.ts'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-20T16:00:00Z')

function store() {
  const items = new Map<string, string>()

  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: store(), configurable: true })
  resetDiskSnooze()
})

test('a computer with no dismissal is not snoozed', () => {
  assert.equal(diskSnoozed('d1', 93, NOW), false)
})

test('Dismiss quiets that computer for a day, and no other', () => {
  dismissDisk('d1', 93, NOW)
  assert.equal(diskSnoozed('d1', 93, NOW), true)
  assert.equal(diskSnoozed('d1', 93, NOW + DAY - 1), true)
  assert.equal(diskSnoozed('d1', 93, NOW + DAY), false)
  assert.equal(diskSnoozed('d2', 93, NOW), false)
})

test('it comes back early once the disk is materially worse', () => {
  dismissDisk('d1', 93, NOW)
  assert.equal(diskSnoozed('d1', 95, NOW), true)
  assert.equal(diskSnoozed('d1', 96, NOW), false)
  // Freeing some space does not re-arm the warning the person already put away.
  assert.equal(diskSnoozed('d1', 91, NOW), true)
})

test('a dismissal outlives the window that made it', () => {
  dismissDisk('d1', 93, NOW)
  resetDiskSnooze()
  assert.equal(diskSnoozed('d1', 93, NOW), true)
})

test('an unreadable store is no snooze rather than a failed render', () => {
  globalThis.localStorage.setItem('nuphos.diskSnooze', '{not json')
  resetDiskSnooze()
  assert.equal(diskSnoozed('d1', 93, NOW), false)
})

test('every open chat hears a dismissal', () => {
  let heard = 0
  const stop = subscribeDiskSnooze(() => heard++)

  dismissDisk('d1', 93, NOW)
  assert.equal(heard, 1)
  stop()
  dismissDisk('d2', 93, NOW)
  assert.equal(heard, 1)
})

test('covers and dismissal are the rule, without a store', () => {
  assert.deepEqual(dismissal(93, NOW), { until: NOW + DAY, percent: 93 })
  assert.equal(covers(undefined, 93, NOW), false)
  assert.equal(covers({ until: NOW + 1, percent: 93 }, 93, NOW), true)
  assert.equal(covers({ until: NOW, percent: 93 }, 93, NOW), false)
})
