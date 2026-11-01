import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nestItems } from './nest-items.ts'

const tree = [
  { key: 'child-b', parentKey: 'parent' },
  { key: 'grandchild', parentKey: 'child-a' },
  { key: 'child-a', parentKey: 'parent' },
  { key: 'parent' },
  { key: 'other' },
]

test('children follow their parent, in list order, one level deeper', () => {
  assert.deepEqual(
    nestItems(tree).map(({ item, depth }) => `${item.key}:${depth}`),
    ['parent:0', 'child-b:1', 'child-a:1', 'grandchild:2', 'other:0'],
  )
})

test('the trail says which levels continue below a row', () => {
  assert.deepEqual(
    nestItems(tree).map(({ item, trail, hasChildren }) => [item.key, trail, hasChildren]),
    [
      ['parent', [], true],
      ['child-b', [true], false],
      ['child-a', [false], true],
      ['grandchild', [false, false], false],
      ['other', [], false],
    ],
  )
})

test('a folded parent hides its whole subtree but still has children', () => {
  const rows = nestItems(tree, (key) => key === 'parent')

  assert.deepEqual(
    rows.map(({ item }) => item.key),
    ['parent', 'other'],
  )
  assert.equal(rows[0]!.hasChildren, true)
  assert.deepEqual(
    rows[0]!.hidden.map((item) => item.key),
    ['child-b', 'child-a', 'grandchild'],
  )
})

test('a row whose parent is not listed is top-level', () => {
  assert.deepEqual(
    nestItems([{ key: 'thread', parentKey: 'pinned' }, { key: 'b' }]).map(({ item, depth }) => [
      item.key,
      depth,
    ]),
    [
      ['thread', 0],
      ['b', 0],
    ],
  )
})

const threads = [
  { key: 'parent' },
  { key: 'running', parentKey: 'parent' },
  { key: 'finished', parentKey: 'parent', finished: true },
  { key: 'last', parentKey: 'parent', finished: true },
]

test('finished children leave the list and their parent counts them', () => {
  const rows = nestItems(threads)

  assert.deepEqual(
    rows.map(({ item }) => item.key),
    ['parent', 'running'],
  )
  assert.deepEqual(
    rows[0]?.done.map((item) => item.key),
    ['finished', 'last'],
  )
  // The guide stops at the last listed child, not at a finished one.
  assert.deepEqual(rows[1]?.trail, [false])
})

test('a parent whose children all finished has none to fold', () => {
  const rows = nestItems(
    threads.filter((item) => item.key !== 'running'),
    () => true,
  )

  assert.deepEqual(
    rows.map(({ item, hasChildren, hidden }) => [item.key, hasChildren, hidden.length]),
    [['parent', false, 0]],
  )
  assert.equal(rows[0]?.done.length, 2)
})

test('a folded parent hides only the children still listed, and no count', () => {
  const rows = nestItems(threads, (key) => key === 'parent')

  assert.deepEqual(
    rows[0]?.hidden.map((item) => item.key),
    ['running'],
  )
  assert.deepEqual(rows[0]?.done, [])
})

test('a finished child stays while one of its own children still shows', () => {
  const rows = nestItems([
    { key: 'parent' },
    { key: 'child', parentKey: 'parent', finished: true },
    { key: 'grandchild', parentKey: 'child' },
    { key: 'quiet', parentKey: 'child', finished: true },
  ])

  assert.deepEqual(
    rows.map(({ item, depth, done }) => [item.key, depth, done.length]),
    [
      ['parent', 0, 0],
      ['child', 1, 1],
      ['grandchild', 2, 0],
    ],
  )
})

test('a finished row without a listed parent stays at the top level', () => {
  assert.deepEqual(
    nestItems([{ key: 'thread', parentKey: 'pinned', finished: true }]).map(({ item }) => item.key),
    ['thread'],
  )
})
