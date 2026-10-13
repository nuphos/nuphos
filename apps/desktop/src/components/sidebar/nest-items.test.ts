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
