import assert from 'node:assert/strict'
import { test } from 'node:test'

import { foldDoneThreads } from './done-threads.ts'
import { nestItems } from './nest-items.ts'

type Row = { key: string; parentKey?: string; threadDone?: boolean; active?: boolean }

const thread = (key: string, parentKey: string, threadDone = true): Row => ({
  key,
  parentKey,
  threadDone,
})
const fold = (parentKey: string, count: number, open: boolean, active: boolean): Row => ({
  key: `fold:${parentKey}:${count}:${open ? 'open' : 'closed'}${active ? ':active' : ''}`,
  parentKey,
})
const layout = (rows: Row[], open = false) =>
  nestItems(foldDoneThreads(rows, () => open, fold)).map(
    ({ item, depth }) => `${'  '.repeat(depth)}${item.key}`,
  )

test('finished threads fold behind one row after the running ones', () => {
  const rows = [
    thread('a', 'p'),
    thread('b', 'p', false),
    thread('c', 'p'),
    { key: 'p' },
    { key: 'q' },
  ]

  assert.deepEqual(layout(rows), ['p', '  b', '  fold:p:2:closed', 'q'])
  assert.deepEqual(layout(rows, true), ['p', '  b', '  fold:p:2:open', '  a', '  c', 'q'])
})

test('one finished thread stays visible on its own', () => {
  assert.deepEqual(layout([{ key: 'p' }, thread('a', 'p')]), ['p', '  a'])
})

test('a finished thread with a running thread under it stays out of the done fold', () => {
  const rows = [
    { key: 'p' },
    thread('a', 'p'),
    thread('a1', 'a', false),
    thread('b', 'p'),
    thread('c', 'p'),
  ]

  assert.deepEqual(layout(rows), ['p', '  a', '    a1', '  fold:p:2:closed'])
})

test('the open chat folds like any finished thread, and its closed fold takes the highlight', () => {
  const rows = [{ key: 'p' }, { ...thread('b', 'p'), active: true }, thread('c', 'p')]

  assert.deepEqual(layout(rows), ['p', '  fold:p:2:closed:active'])
  assert.deepEqual(layout(rows, true), ['p', '  fold:p:2:open', '  b', '  c'])
})

test('a folded thread takes its own finished threads with it', () => {
  const rows = [{ key: 'p' }, thread('a', 'p'), thread('a1', 'a'), thread('b', 'p')]

  assert.deepEqual(layout(rows), ['p', '  fold:p:2:closed'])
  assert.deepEqual(layout(rows, true), ['p', '  fold:p:2:open', '  a', '    a1', '  b'])
})
