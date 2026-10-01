import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import {
  browserHistoryKey,
  parseBrowserHistory,
  readBrowserHistorySnapshot,
  recordBrowserVisit,
  searchBrowserHistory,
  subscribeBrowserHistory,
} from './browserHistory.ts'

const storage = new Map<string, string>()
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

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

test('history persists titles, deduplicates revisits, and isolates users and teams', () => {
  recordBrowserVisit('user', 'team', 'https://example.com/', 'Example Domain')
  recordBrowserVisit('user', 'team', 'https://example.com/docs', 'Documentation')
  recordBrowserVisit('user', 'team', 'https://example.com/', 'Example updated')
  const key = browserHistoryKey('user', 'team')
  const entries = parseBrowserHistory(readBrowserHistorySnapshot(key))

  assert.deepEqual(
    entries.map(({ url, title }) => ({ url, title })),
    [
      { url: 'https://example.com/', title: 'Example updated' },
      { url: 'https://example.com/docs', title: 'Documentation' },
    ],
  )
  assert.equal(readBrowserHistorySnapshot(browserHistoryKey('other', 'team')), null)
  assert.equal(readBrowserHistorySnapshot(browserHistoryKey('user', 'other')), null)
})

test('history search matches title and URL terms, newest first, and limits results', () => {
  const entries = Array.from({ length: 15 }, (_, i) => ({
    url: `https://example.com/${i}`,
    title: `Example Docs ${i}`,
    visitedAt: i,
  }))
  const matches = searchBrowserHistory(entries, 'DOCS example.com')

  assert.equal(matches.length, 10)
  assert.equal(matches[0].visitedAt, 14)
  assert.equal(searchBrowserHistory(entries, 'missing').length, 0)
  assert.deepEqual(searchBrowserHistory(entries, '   '), [])
})

test('malformed history and non-web URLs cannot become history destinations', () => {
  assert.deepEqual(parseBrowserHistory('broken'), [])
  assert.deepEqual(parseBrowserHistory('{}'), [])
  assert.deepEqual(
    parseBrowserHistory('[null,{}, {"url":"file:///tmp/test","title":"File","visitedAt":1}]'),
    [],
  )
  recordBrowserVisit('unsafe', 'team', 'file:///tmp/test', 'File')
  assert.equal(readBrowserHistorySnapshot(browserHistoryKey('unsafe', 'team')), null)
})

test('subscribers update for their own history and unsubscribe cleanly', () => {
  let updates = 0
  const unsubscribe = subscribeBrowserHistory(browserHistoryKey('watcher', 'team'), () => {
    updates += 1
  })

  recordBrowserVisit('someone-else', 'team', 'https://example.com/', 'Example')
  assert.equal(updates, 0)
  recordBrowserVisit('watcher', 'team', 'https://example.com/', 'Example')
  assert.equal(updates, 1)
  unsubscribe()
  recordBrowserVisit('watcher', 'team', 'https://example.com/next', 'Next')
  assert.equal(updates, 1)
})

test('history retains at most 500 recent unique pages', () => {
  for (let i = 0; i < 505; i += 1)
    recordBrowserVisit('bounded', 'team', `https://example.com/${i}`, `Page ${i}`)
  const entries = parseBrowserHistory(
    readBrowserHistorySnapshot(browserHistoryKey('bounded', 'team')),
  )

  assert.equal(entries.length, 500)
  assert.equal(entries[0].url, 'https://example.com/504')
  assert.equal(entries.at(-1)?.url, 'https://example.com/5')
})
