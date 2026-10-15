import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { claimDisplay, listDesktops, lockFile, readLock, reap } from './desktop-session.mjs'

test('each session gets its own display, the lowest free one, and keeps it', () => {
  const pool = mkdtempSync(path.join(os.tmpdir(), 'desktops-'))

  assert.equal(claimDisplay(pool, 's1', 3), 2)
  assert.equal(claimDisplay(pool, 's2', 3), 3)
  assert.equal(claimDisplay(pool, 's1', 3), 2)
  assert.equal(claimDisplay(pool, 's3', 3), 4)
  assert.equal(claimDisplay(pool, 's4', 3), null)
  assert.deepEqual(
    listDesktops(pool).map((d) => [d.display, d.sessionId]),
    [
      [2, 's1'],
      [3, 's2'],
      [4, 's3'],
    ],
  )
  assert.equal(readLock(pool, 2)?.pid, process.pid)
})

test('a slot whose owner died is skipped until the reaper frees it', () => {
  const pool = mkdtempSync(path.join(os.tmpdir(), 'desktops-'))

  writeFileSync(
    lockFile(pool, 2),
    JSON.stringify({ sessionId: 'gone', pid: 2 ** 22 - 1, since: 'x' }),
  )
  assert.deepEqual(listDesktops(pool), [])
  assert.equal(claimDisplay(pool, 's1', 2), 3)
  reap(pool)
  assert.equal(readLock(pool, 2), null)
  assert.equal(claimDisplay(pool, 's2', 2), 2)
  // A session whose earlier run died gets its own slot back, under its new pid.
  writeFileSync(
    lockFile(pool, 3),
    JSON.stringify({ sessionId: 's3', pid: 2 ** 22 - 1, since: 'x' }),
  )
  assert.equal(claimDisplay(pool, 's3', 2), 3)
  assert.equal(readLock(pool, 3)?.pid, process.pid)
})
