import assert from 'node:assert/strict'
import { test } from 'node:test'

import { paneRects, removePane, splitPane } from './splitLayout.ts'

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
