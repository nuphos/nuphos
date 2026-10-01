import assert from 'node:assert/strict'
import test from 'node:test'

import { orderBrowserPanes } from './browserPaneOrder.ts'

/** A pane, named so the assertions read as "which slot did it land in". */
function pane(id: string, createdSeq: number) {
  return { id, createdSeq }
}

function ids(tabs: { id: string }[]) {
  return tabs.map((tab) => tab.id)
}

test('panes render in creation order, whatever order they arrive in', () => {
  // The buckets can hand them over in any order; the rendered order must not
  // depend on that, or a pane would move the moment a bucket is rebuilt.
  assert.deepEqual(ids(orderBrowserPanes([pane('b', 2), pane('a', 1)])), ['a', 'b'])
  assert.deepEqual(ids(orderBrowserPanes([pane('a', 1), pane('b', 2)])), ['a', 'b'])
})

test('a newly opened pane lands at the end, never in front of an existing one', () => {
  const existing = [pane('a', 1), pane('b', 2)]
  // Created later, so it sorts later — whatever its id happens to be.
  const opened = pane('0-sorts-first-alphabetically', 3)

  assert.deepEqual(ids(orderBrowserPanes([opened, ...existing])), [
    'a',
    'b',
    '0-sorts-first-alphabetically',
  ])
})

test('closing a pane leaves the survivors where they were', () => {
  const all = [pane('a', 1), pane('b', 2), pane('c', 3)]

  assert.deepEqual(ids(orderBrowserPanes(all.filter((p) => p.id !== 'b'))), ['a', 'c'])
})

test('the order is a pure function of the panes, so a repeat call matches', () => {
  const all = [pane('b', 2), pane('a', 1), pane('c', 3)]

  assert.deepEqual(ids(orderBrowserPanes(all)), ids(orderBrowserPanes(all)))
  // And the input is left alone — callers pass the live list straight in.
  assert.deepEqual(ids(all), ['b', 'a', 'c'])
})

test('a tie falls back to the id rather than to argument order', () => {
  assert.deepEqual(ids(orderBrowserPanes([pane('b', 1), pane('a', 1)])), ['a', 'b'])
  assert.deepEqual(ids(orderBrowserPanes([pane('a', 1), pane('b', 1)])), ['a', 'b'])
})
