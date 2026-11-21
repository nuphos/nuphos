import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fullestDisk, noteOomKills } from './device-metrics.ts'

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

const vmstat = (kills: number) => `pgfault 912\noom_kill ${String(kills)}\npgmajfault 3\n`

test('an OOM kill is dated when the kernel count rises between readings, not on the first', () => {
  const first = noteOomKills({}, vmstat(2), '2026-11-21T08:00:00.000Z')

  // Kills from before the host started have no time it could honestly give.
  assert.deepEqual(first, { count: 2, at: undefined })
  // Only slow, nothing killed: a dropped tunnel alone says nothing about memory.
  const same = noteOomKills(first, vmstat(2), '2026-11-21T08:05:00.000Z')

  assert.equal(same.at, undefined)
  const killed = noteOomKills(same, vmstat(3), '2026-11-21T08:09:00.000Z')

  assert.deepEqual(killed, { count: 3, at: '2026-11-21T08:09:00.000Z' })
  assert.equal(noteOomKills(killed, vmstat(3), '2026-11-21T09:00:00.000Z').at, killed.at)
})

test('an unreadable or count-less vmstat keeps what was seen', () => {
  const seen = { count: 4, at: '2026-11-21T08:09:00.000Z' }

  assert.equal(noteOomKills(seen, '', '2026-11-21T09:00:00.000Z'), seen)
  assert.equal(noteOomKills(seen, 'pgfault 1\n', '2026-11-21T09:00:00.000Z'), seen)
})
