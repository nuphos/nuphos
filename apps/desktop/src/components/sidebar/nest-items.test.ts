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

test('finished children stay under their parent', () => {
  const rows = nestItems(threads)

  assert.deepEqual(
    rows.map(({ item, depth }) => [item.key, depth]),
    [
      ['parent', 0],
      ['running', 1],
      ['finished', 1],
      ['last', 1],
    ],
  )
  assert.deepEqual(rows[3]?.trail, [false])
})

test('a parent whose children all finished can still fold them', () => {
  const allFinished = threads.filter((item) => item.key !== 'running')

  assert.deepEqual(
    nestItems(allFinished, () => true).map(({ item, hasChildren, hidden }) => [
      item.key,
      hasChildren,
      hidden.map((kid) => kid.key),
    ]),
    [['parent', true, ['finished', 'last']]],
  )
})
