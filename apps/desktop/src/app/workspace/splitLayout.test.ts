import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  dropPane,
  dropZone,
  focusPaneState,
  PREVIEW_PANE,
  paneRects,
  paneShowingSession,
  previewDrop,
  removePane,
  splitPane,
} from './splitLayout.ts'

test('repeated horizontal splits produce three equal panes', () => {
  const layout = splitPane(splitPane({ id: 'a' }, 'a', 'b', 'row'), 'b', 'c', 'row')
  const rects = paneRects(layout)

  assert.deepEqual(
    rects.map((rect) => rect.id),
    ['a', 'b', 'c'],
  )
  for (const rect of rects) {
    assert.equal(rect.width, 100 / 3)
    assert.equal(rect.height, 100)
  }
})

test('vertical splits grow equally and mixed splits affect only the target', () => {
  const stacked = splitPane(splitPane({ id: 'a' }, 'a', 'b', 'column'), 'b', 'c', 'column')

  assert.ok(paneRects(stacked).every((rect) => Math.abs(rect.height - 100 / 3) < 1e-9))
  const layout = splitPane(splitPane({ id: 'a' }, 'a', 'b', 'row'), 'b', 'c', 'column')

  assert.deepEqual(paneRects(layout), [
    { id: 'a', left: 0, top: 0, width: 50, height: 100 },
    { id: 'b', left: 50, top: 0, width: 50, height: 50 },
    { id: 'c', left: 50, top: 50, width: 50, height: 50 },
  ])
})

test('closing panes collapses empty branches without changing survivor identities', () => {
  const layout = splitPane(splitPane({ id: 'a' }, 'a', 'b', 'row'), 'b', 'c', 'column')
  const next = removePane(layout, 'b')

  assert.ok(next)
  assert.deepEqual(paneRects(next), [
    { id: 'a', left: 0, top: 0, width: 50, height: 100 },
    { id: 'c', left: 50, top: 0, width: 50, height: 100 },
  ])
  assert.deepEqual(removePane(next, 'a'), { id: 'c' })
  assert.equal(removePane({ id: 'c' }, 'c'), null)
})

test('closing the original pane leaves a stable first leaf to take over persistence', () => {
  const layout = splitPane({ id: 'primary' }, 'primary', 'surviving-pane', 'row')
  const next = removePane(layout, 'primary')

  assert.ok(next)
  assert.deepEqual(paneRects(next), [
    { id: 'surviving-pane', left: 0, top: 0, width: 100, height: 100 },
  ])
  const expanded = splitPane(next, 'surviving-pane', 'another-pane', 'column')

  assert.equal(paneRects(expanded)[0].id, 'surviving-pane')
})

type Shown = { sessionId: string | null; teamId?: string }
const shown = (map: Record<string, Shown>) => (pane: string) => map[pane]

test('a chat already open in some pane is found there, the focused pane first', () => {
  const panes = shown({ a: { sessionId: 'x' }, b: { sessionId: 'y' }, c: { sessionId: 'y' } })

  assert.equal(paneShowingSession(['a', 'b', 'c'], panes, 'y'), 'b')
  assert.equal(paneShowingSession(['c', 'a', 'b'], panes, 'y'), 'c')
})

test('a chat open nowhere finds no pane, so a background pane is never retargeted', () => {
  // Pane b holds the chat a previous Cmd-click opened beside a; opening z must not reuse it.
  const panes = shown({ a: { sessionId: 'x' }, b: { sessionId: 'y' } })

  assert.equal(paneShowingSession(['a', 'b'], panes, 'z'), null)
  // A pane that is gone or on its main page shows no chat.
  assert.equal(paneShowingSession(['a', 'gone'], panes, 'gone'), null)
})

test('a chat open in another team is not the one asked for', () => {
  const panes = shown({ a: { sessionId: 'x', teamId: 't1' } })

  assert.equal(paneShowingSession(['a'], panes, 'x', 't2'), null)
  assert.equal(paneShowingSession(['a'], panes, 'x', 't1'), 'a')
  assert.equal(paneShowingSession(['a'], panes, 'x'), 'a')
})

test('changing panes closes search permanently while focusing the current pane preserves it', () => {
  const open = { activeId: 'primary', sessionSearchOpen: true }

  assert.equal(focusPaneState(open, 'primary'), open)
  const beside = focusPaneState(open, 'beside')

  assert.equal(beside.sessionSearchOpen, false)
  assert.deepEqual(focusPaneState(beside, 'primary'), {
    activeId: 'primary',
    sessionSearchOpen: false,
  })
})

test('edge bands pick a side and the middle replaces the pane', () => {
  assert.equal(dropZone(0.1, 0.5), 'left')
  assert.equal(dropZone(0.9, 0.5), 'right')
  assert.equal(dropZone(0.5, 0.05), 'top')
  assert.equal(dropZone(0.6, 0.95), 'bottom')
  assert.equal(dropZone(0.5, 0.5), 'center')
  assert.equal(dropZone(0.3, 0.7), 'center')
})

test('dropping a new pane on a left or top edge places it before the target', () => {
  const ids = (layout: Parameters<typeof paneRects>[0]) => paneRects(layout).map((r) => r.id)

  assert.deepEqual(ids(dropPane({ id: 'a' }, 'a', 'b', 'left')), ['b', 'a'])
  assert.deepEqual(ids(dropPane({ id: 'a' }, 'a', 'b', 'right')), ['a', 'b'])
  const top = dropPane({ id: 'a' }, 'a', 'b', 'top')

  assert.deepEqual(ids(top), ['b', 'a'])
  assert.equal(paneRects(top)[0].width, 100)
})

test('moving a pane takes it out of its old spot and keeps every identity', () => {
  const row = splitPane(splitPane({ id: 'a' }, 'a', 'b', 'row'), 'b', 'c', 'row')
  const moved = dropPane(row, 'c', 'a', 'bottom')

  assert.deepEqual(moved, {
    direction: 'row',
    children: [{ id: 'b' }, { direction: 'column', children: [{ id: 'c' }, { id: 'a' }] }],
  })
  assert.equal(dropPane(row, 'b', 'b', 'left'), row)
  // Two panes swap sides when one is dropped on the other's far edge.
  assert.deepEqual(dropPane(splitPane({ id: 'a' }, 'a', 'b', 'row'), 'b', 'a', 'right'), {
    direction: 'row',
    children: [{ id: 'b' }, { id: 'a' }],
  })
})

test('dropping a pane on another pane centre swaps them in place', () => {
  const layout = splitPane(splitPane({ id: 'a' }, 'a', 'b', 'row'), 'b', 'c', 'column')

  assert.deepEqual(dropPane(layout, 'c', 'a', 'center'), {
    direction: 'row',
    children: [{ id: 'c' }, { direction: 'column', children: [{ id: 'b' }, { id: 'a' }] }],
  })
  // A chat that is not a pane yet never swaps in.
  assert.equal(dropPane(layout, 'a', 'z', 'center'), layout)
})

test('a drop preview is the layout letting go would leave', () => {
  const layout = splitPane({ id: 'a' }, 'a', 'b', 'row')

  assert.equal(previewDrop(layout, null), layout)
  assert.deepEqual(previewDrop(layout, { target: 'b', zone: 'center', pane: 'a' }), {
    direction: 'row',
    children: [{ id: 'b' }, { id: 'a' }],
  })
  assert.deepEqual(
    previewDrop(layout, { target: 'b', zone: 'bottom', pane: 'a' }),
    dropPane(layout, 'b', 'a', 'bottom'),
  )
})

test('a sidebar chat previews a new pane only when it would split', () => {
  const layout = splitPane({ id: 'a' }, 'a', 'b', 'row')

  assert.equal(previewDrop(layout, { target: 'a', zone: 'center', pane: null }), layout)
  assert.deepEqual(
    paneRects(previewDrop(layout, { target: 'a', zone: 'left', pane: null })).map((r) => r.id),
    [PREVIEW_PANE, 'a', 'b'],
  )
})

const widths = (layout: Parameters<typeof paneRects>[0]) =>
  Object.fromEntries(paneRects(layout).map((r) => [r.id, Math.round(r.width * 100) / 100]))

test('a pane added to a row of a two-column grid splits that whole row equally', () => {
  // Two columns of two read as a top row (a, b) and a bottom row (c, d).
  let layout = splitPane({ id: 'a' }, 'a', 'b', 'row')

  layout = splitPane(splitPane(layout, 'a', 'c', 'column'), 'b', 'd', 'column')
  layout = splitPane(layout, 'd', 'e', 'row')

  assert.deepEqual(widths(layout), { a: 50, b: 50, c: 33.33, d: 33.33, e: 33.33 })
  assert.deepEqual(
    paneRects(layout).map((r) => [r.id, r.top]),
    [
      ['a', 0],
      ['b', 0],
      ['c', 50],
      ['d', 50],
      ['e', 50],
    ],
  )
  // Dropping one more on the middle pane's left edge keeps the row even.
  assert.deepEqual(widths(dropPane(layout, 'd', 'f', 'left')), {
    a: 50,
    b: 50,
    c: 25,
    f: 25,
    d: 25,
    e: 25,
  })
})

test('a stack beside a full-height pane still splits only its target', () => {
  const layout = splitPane(splitPane({ id: 'a' }, 'a', 'b', 'row'), 'b', 'c', 'column')

  assert.deepEqual(widths(splitPane(layout, 'c', 'd', 'row')), { a: 50, b: 50, c: 25, d: 25 })
})

test('closing a pane lets the rest of its row share the width equally', () => {
  // row[c, column[row[d, e], f]]: closing f must not leave d and e at a quarter each.
  const layout = splitPane(
    splitPane(splitPane({ id: 'c' }, 'c', 'd', 'row'), 'd', 'f', 'column'),
    'd',
    'e',
    'row',
  )
  const next = removePane(layout, 'f')

  assert.ok(next)
  assert.deepEqual(widths(next), { c: 33.33, d: 33.33, e: 33.33 })
  const row = removePane(next, 'd')

  assert.ok(row)
  assert.deepEqual(widths(row), { c: 50, e: 50 })
})
