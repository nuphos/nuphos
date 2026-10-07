import assert from 'node:assert/strict'
import { test } from 'node:test'

import { heatmapRows } from './teamActivity.ts'

test('heatmapRows gives each member a row of timed cells naming their sessions', () => {
  const start = new Date(Date.UTC(2026, 9, 7, 10, 0))
  const rows = heatmapRows({
    range: '1d',
    slotMinutes: 30,
    start: start.toISOString(),
    sessions: [
      { id: 's1', title: 'Fix CI' },
      { id: 's2', title: 'Deploy' },
    ],
    members: [
      { id: 'a', name: 'Alice', avatarURL: '', slots: [[0, 1], [1], []] },
      { id: 'b', name: 'Bob', avatarURL: '', slots: [[], [], [0]] },
    ],
  })

  assert.deepEqual(
    rows.map((r) => r.name),
    ['Alice', 'Bob'],
  )
  const [busy, single, empty] = rows[0]?.cells ?? []

  assert.deepEqual(
    busy?.sessions.map((s) => s.title),
    ['Fix CI', 'Deploy'],
  )
  assert.equal(busy?.level, 4)
  assert.equal(single?.level, 2)
  assert.equal(empty?.level, 0)
  assert.equal(single?.start.toISOString(), '2026-10-07T10:30:00.000Z')
  assert.equal(single?.end.toISOString(), '2026-10-07T11:00:00.000Z')
})
