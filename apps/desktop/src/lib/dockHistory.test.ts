import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import {
  dockHistoryKey,
  frecency,
  parseDockHistory,
  readDockHistorySnapshot,
  recordDockVisit,
  searchDockHistory,
  subscribeDockHistory,
} from './dockHistory.ts'

const storage = new Map<string, string>()
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const DAY = 24 * 60 * 60 * 1000

before(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
})
after(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

const read = (userId: string, teamId = 'team') =>
  parseDockHistory(readDockHistorySnapshot(dockHistoryKey(userId, teamId)))

test('opens count per page, renames do not, and users and teams stay apart', () => {
  recordDockVisit('user', 'team', {
    href: '/teams/t/dashboards/1',
    title: 'Dashboard',
    opened: true,
  })
  recordDockVisit('user', 'team', { href: '/teams/t/dashboards/1', title: 'Cost', opened: false })
  recordDockVisit('user', 'team', { href: '/teams/t/dashboards/1', title: 'Cost', opened: true })

  assert.deepEqual(
    read('user').map(({ href, title, count }) => ({ href, title, count })),
    [{ href: '/teams/t/dashboards/1', title: 'Cost', count: 2 }],
  )
  assert.equal(readDockHistorySnapshot(dockHistoryKey('other', 'team')), null)
  assert.equal(readDockHistorySnapshot(dockHistoryKey('user', 'other')), null)
})

test('frecency weighs opens by recency, halving each week', () => {
  const now = 100 * DAY

  assert.equal(frecency({ href: '/a', title: 'A', count: 4, openedAt: now }, now), 4)
  assert.equal(frecency({ href: '/a', title: 'A', count: 4, openedAt: now - 7 * DAY }, now), 2)
})

test('search matches title and decoded path terms, most frecent first', () => {
  const now = 100 * DAY
  const entries = [
    { href: '/teams/t/github/zeabur%2Fnuphos', title: 'nuphos', count: 1, openedAt: now },
    { href: '/teams/t/github/zeabur%2Fzeabur', title: 'zeabur', count: 9, openedAt: now },
    { href: '/teams/t/plans', title: 'Plans', count: 50, openedAt: now },
  ]

  assert.deepEqual(
    searchDockHistory(entries, 'GITHUB zeabur/', now).map((entry) => entry.title),
    ['zeabur', 'nuphos'],
  )
  assert.equal(searchDockHistory(entries, '  ', now)[0].title, 'Plans')
  assert.deepEqual(searchDockHistory(entries, 'missing', now), [])
})

test('malformed history and non-app paths are dropped', () => {
  assert.deepEqual(parseDockHistory('broken'), [])
  assert.deepEqual(parseDockHistory('{}'), [])
  assert.deepEqual(
    parseDockHistory('[null,{}, {"href":"https://x","title":"X","count":1,"openedAt":1}]'),
    [],
  )
})

test('subscribers update for their own history and unsubscribe cleanly', () => {
  let updates = 0
  const unsubscribe = subscribeDockHistory(dockHistoryKey('watcher', 'team'), () => {
    updates += 1
  })

  recordDockVisit('someone-else', 'team', { href: '/a', title: 'A', opened: true })
  assert.equal(updates, 0)
  recordDockVisit('watcher', 'team', { href: '/a', title: 'A', opened: true })
  assert.equal(updates, 1)
  unsubscribe()
  recordDockVisit('watcher', 'team', { href: '/b', title: 'B', opened: true })
  assert.equal(updates, 1)
})

test('history keeps at most 500 pages', () => {
  for (let i = 0; i < 505; i += 1)
    recordDockVisit('bounded', 'team', { href: `/p/${i}`, title: `Page ${i}`, opened: true })

  assert.equal(read('bounded').length, 500)
})
