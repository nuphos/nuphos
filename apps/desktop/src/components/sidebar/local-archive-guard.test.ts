import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ARCHIVE_IN_FLIGHT, visibleSidebarChats, withRestoredChats } from './local-archive-guard.ts'

const rows = [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c', archivedAt: '2026-09-01' }]

test('server-archived rows never list', () => {
  assert.deepEqual(
    visibleSidebarChats(rows, new Map(), 1).map((row) => row.sessionId),
    ['a', 'b'],
  )
})

test('an in-flight archive hides the row from every listing', () => {
  const guard = new Map([['a', ARCHIVE_IN_FLIGHT]])

  assert.deepEqual(
    visibleSidebarChats(rows, guard, 99).map((row) => row.sessionId),
    ['b'],
  )
  assert.ok(guard.has('a'))
})

test('a listing no newer than the archive stays guarded', () => {
  const guard = new Map([['a', 5]])

  assert.deepEqual(
    visibleSidebarChats(rows, guard, 5).map((row) => row.sessionId),
    ['b'],
  )
  assert.ok(guard.has('a'))
})

test('a later listing is authoritative, so a restored chat lists again', () => {
  const guard = new Map([['a', 5]])

  assert.deepEqual(
    visibleSidebarChats(rows, guard, 6).map((row) => row.sessionId),
    ['a', 'b'],
  )
  assert.equal(guard.size, 0)
})

const active = [
  { sessionId: 'x', lastActiveAt: '2026-10-03' },
  { sessionId: 'z', lastActiveAt: '2026-10-01' },
]
const restoredRow = { sessionId: 'y', lastActiveAt: '2026-10-02' }

test('a listing no newer than the restore gets the row back in activity order', () => {
  const guard = new Map([['y', { row: restoredRow, settledSeq: 5 }]])

  assert.deepEqual(
    withRestoredChats(active, guard, 5).map((row) => row.sessionId),
    ['x', 'y', 'z'],
  )
  assert.ok(guard.has('y'))
})

test('a restored row older than every listed row goes last', () => {
  const guard = new Map([
    ['y', { row: { sessionId: 'y', lastActiveAt: '2026-09-01' }, settledSeq: 5 }],
  ])

  assert.deepEqual(
    withRestoredChats(active, guard, 5).map((row) => row.sessionId),
    ['x', 'z', 'y'],
  )
})

test('a listing that already has the restored row keeps its copy', () => {
  const fresh = { sessionId: 'y', lastActiveAt: '2026-10-04' }
  const guard = new Map([['y', { row: restoredRow, settledSeq: 5 }]])
  const listed = withRestoredChats([fresh, ...active], guard, 5)

  assert.equal(listed.length, 3)
  assert.equal(listed[0], fresh)
})

test('a later listing is authoritative, so the restore guard lets go', () => {
  const guard = new Map([['y', { row: restoredRow, settledSeq: 5 }]])

  assert.deepEqual(
    withRestoredChats(active, guard, 6).map((row) => row.sessionId),
    ['x', 'z'],
  )
  assert.equal(guard.size, 0)
})

test('the archive guard still wins over a restored row', () => {
  const restored = new Map([['y', { row: restoredRow, settledSeq: 5 }]])
  const archived = new Map([['y', ARCHIVE_IN_FLIGHT]])

  assert.deepEqual(
    visibleSidebarChats(withRestoredChats(active, restored, 5), archived, 5).map(
      (row) => row.sessionId,
    ),
    ['x', 'z'],
  )
})
