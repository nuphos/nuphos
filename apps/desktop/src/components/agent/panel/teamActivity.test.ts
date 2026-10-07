import assert from 'node:assert/strict'
import { test } from 'node:test'

import { heatmapRows } from './teamActivity.ts'

test('heatmapRows puts each slot in its local day row and time-of-day column', () => {
  // 30-minute slots starting 23:00 local time, spanning midnight.
  const start = new Date(2026, 9, 6, 23, 0)
  const rows = heatmapRows({
    range: '1d',
    slotMinutes: 30,
    start: start.toISOString(),
    slots: [0, 2, 4, 1],
  })

  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.day.getDate(), 6)
  assert.equal(rows[1]?.day.getDate(), 7)
  assert.equal(rows[0]?.cells.length, 48)
  // 23:00 and 23:30 on the first day, 00:00 and 00:30 on the next.
  assert.deepEqual(
    rows[0]?.cells.slice(46).map((c) => c && [c.count, c.level]),
    [
      [0, 0],
      [2, 2],
    ],
  )
  assert.deepEqual(
    rows[1]?.cells.slice(0, 2).map((c) => c && [c.count, c.level]),
    [
      [4, 4],
      [1, 1],
    ],
  )
  // Slots outside the range stay empty.
  assert.equal(rows[0]?.cells[0], null)
  assert.equal(rows[1]?.cells[2], null)
})
