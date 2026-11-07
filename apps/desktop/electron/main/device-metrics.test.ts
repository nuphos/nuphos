import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fullestDisk } from './device-metrics.ts'

const fs = (blocks: number, bfree: number) => ({ blocks, bfree, bsize: 4096 })

test('reports the fullest filesystem, not the largest', () => {
  const root = fs(4_000, 0)
  const data = fs(20_000, 10_000)

  assert.deepEqual(fullestDisk([root, data]), { used: 4_000 * 4096, total: 4_000 * 4096 })
  assert.deepEqual(fullestDisk([data, root]), { used: 4_000 * 4096, total: 4_000 * 4096 })
})

test('a filesystem behind several paths reports what a single disk does', () => {
  const disk = fs(1_000, 250)

  assert.deepEqual(fullestDisk([disk, disk, disk]), fullestDisk([disk]))
  assert.deepEqual(fullestDisk([disk]), { used: 750 * 4096, total: 1_000 * 4096 })
})

test('ignores empty filesystems and fails when nothing could be read', () => {
  assert.deepEqual(fullestDisk([fs(0, 0), fs(100, 50)]), { used: 50 * 4096, total: 100 * 4096 })
  assert.throws(() => fullestDisk([]))
})
