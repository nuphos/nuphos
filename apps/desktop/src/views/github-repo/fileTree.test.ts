import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildFileTree } from './fileTree.ts'

import type { FileTreeNode } from './fileTree.ts'

function shape(nodes: FileTreeNode<{ filename: string }>[]): unknown[] {
  return nodes.map((node) => (node.file ? node.name : { [node.name]: shape(node.children) }))
}

test('groups files by directory and keeps their order', () => {
  const tree = buildFileTree([
    { filename: 'README.md' },
    { filename: 'src/a.ts' },
    { filename: 'src/lib/b.ts' },
    { filename: 'src/c.ts' },
  ])

  assert.deepEqual(shape(tree), ['README.md', { src: ['a.ts', { lib: ['b.ts'] }, 'c.ts'] }])
})

test('folds single-child directory chains into one row', () => {
  const tree = buildFileTree([
    { filename: 'apps/desktop/src/x.ts' },
    { filename: 'apps/desktop/src/y.ts' },
  ])

  assert.deepEqual(shape(tree), [{ 'apps/desktop/src': ['x.ts', 'y.ts'] }])
  assert.equal(tree[0].path, 'apps/desktop/src')
})
