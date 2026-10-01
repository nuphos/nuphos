import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appendArchivedPage, archivedAtLabel } from './archivedChatsList.ts'

const DAY = 24 * 60 * 60 * 1000

test('archive time reads relative to now', () => {
  assert.equal(archivedAtLabel(new Date().toISOString()), 'Archived just now')
  assert.equal(archivedAtLabel(new Date(Date.now() - 3 * DAY).toISOString()), 'Archived 3 days ago')
})

test('a missing or unreadable archive time still labels the row', () => {
  assert.equal(archivedAtLabel(undefined), 'Archived')
  assert.equal(archivedAtLabel('not a date'), 'Archived')
})

test('a later page never duplicates a row already shown', () => {
  const merged = appendArchivedPage(
    [{ sessionId: 'a' }, { sessionId: 'b' }],
    [{ sessionId: 'b' }, { sessionId: 'c' }],
  )

  assert.deepEqual(
    merged.map((row) => row.sessionId),
    ['a', 'b', 'c'],
  )
})
