import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nestItems } from './nest-items.ts'

const rows = (items: ReturnType<typeof nestItems>) =>
  items.map(({ item, depth }) => `${item.key}:${depth}`)

test('children follow their parent, in list order, one level deeper', () => {
  assert.deepEqual(
    rows(
      nestItems([
        { key: 'child-b', parentKey: 'parent' },
        { key: 'grandchild', parentKey: 'child-a' },
        { key: 'child-a', parentKey: 'parent' },
        { key: 'parent' },
        { key: 'other' },
      ]),
    ),
    ['parent:0', 'child-b:1', 'child-a:1', 'grandchild:2', 'other:0'],
  )
})

test('a row whose parent is not listed is top-level', () => {
  assert.deepEqual(rows(nestItems([{ key: 'thread', parentKey: 'pinned' }, { key: 'b' }])), [
    'thread:0',
    'b:0',
  ])
})
