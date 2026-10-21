import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  dropPane,
  dropZone,
  focusPaneState,
  PREVIEW_PANE,
  paneRects,
  previewDrop,
  removePane,
  reusableBesidePane,
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

const shown = (map: Record<string, string>) => (pane: string) => map[pane]

test('a Cmd-click reuses the last beside pane only while it still shows that chat', () => {
  const last = { pane: 'b', sessionId: 's1' }

  assert.equal(reusableBesidePane(null, 'a', shown({})), null)
  assert.equal(reusableBesidePane(last, 'a', shown({ b: 's1' })), 'b')
  // The click came from the beside pane itself: never replace its own chat.
  assert.equal(reusableBesidePane(last, 'b', shown({ b: 's1' })), null)
  // The user opened another chat there, or closed the pane.
  assert.equal(reusableBesidePane(last, 'a', shown({ b: 's2' })), null)
  assert.equal(reusableBesidePane(last, 'a', shown({})), null)
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
