import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  MANUAL_IDLE_MS,
  claimDisplay,
  listDesktops,
  lockFile,
  readLock,
  reap,
} from './desktop-session.mjs'

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

test('a desktop opened by hand is one slot, adopted by the session and freed when unwatched', () => {
  const pool = mkdtempSync(path.join(os.tmpdir(), 'desktops-'))

  // Opening twice claims one display, held by the host and marked manual.
  assert.equal(claimDisplay(pool, 's1', 3, process.pid, true), 2)
  assert.equal(claimDisplay(pool, 's1', 3, process.pid, true), 2)
  assert.deepEqual(readdirSync(pool), ['2.lock'])
  assert.equal(readLock(pool, 2)?.manual, true)
  // The session's own server takes it over; it is no longer manual.
  assert.equal(claimDisplay(pool, 's1', 3, process.ppid), 2)
  assert.equal(readLock(pool, 2)?.pid, process.ppid)
  assert.equal(readLock(pool, 2)?.manual, undefined)

  // A manual desktop nobody watched for MANUAL_IDLE_MS is freed; a watched one stays.
  assert.equal(claimDisplay(pool, 's2', 3, process.pid, true), 3)
  assert.equal(claimDisplay(pool, 's3', 3, process.pid, true), 4)
  const stale = (Date.now() - MANUAL_IDLE_MS - 1_000) / 1000

  utimesSync(lockFile(pool, 3), stale, stale)
  reap(pool)
  assert.deepEqual(
    listDesktops(pool).map((d) => d.sessionId),
    ['s1', 's3'],
  )
})
