import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ARCHIVE_IN_FLIGHT, visibleSidebarChats } from './local-archive-guard.ts'

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
