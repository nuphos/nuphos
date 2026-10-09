import assert from 'node:assert/strict'
import { test } from 'node:test'

import { quotaBuckets, quotaHistoryRows } from './quotaHistoryRows.ts'

import type { RuntimeInstance } from '../../types/runtime'

const agent = (id: string, label: string) => ({ id, label }) as RuntimeInstance
const now = Date.parse('2026-10-09T12:30:00.000Z')

test('every bucket of the range is on the axis, floored like the backend', () => {
  const buckets = quotaBuckets('7d', now)

  assert.equal(buckets.length, 7 * 24 + 1)
  assert.equal(new Date(buckets.at(-1) ?? 0).toISOString(), '2026-10-09T12:00:00.000Z')
})

test('a row per reporting agent, windows by name, bands only where readings stopped', () => {
  const rows = quotaHistoryRows(
    [
      {
        runtimeId: 'a',
        windowId: 'seven_day',
        label: 'Weekly',
        points: [{ at: '2026-10-09T09:00:00.000Z', usedPercent: 40 }],
      },
      {
        runtimeId: 'a',
        windowId: 'five_hour',
        label: '5-hour',
        points: [
          { at: '2026-10-09T09:00:00.000Z', usedPercent: 20 },
          { at: '2026-10-09T11:00:00.000Z', usedPercent: 35 },
        ],
      },
      // An agent this caller no longer lists is left out.
      {
        runtimeId: 'gone',
        windowId: 'five_hour',
        label: '5-hour',
        points: [{ at: '2026-10-09T10:00:00.000Z', usedPercent: 99 }],
      },
    ],
    // An agent with nothing recorded gets no row.
    [agent('a', 'Claude'), agent('b', 'Codex')],
    '7d',
    now,
  )

  assert.deepEqual(
    rows.map((row) => [row.instance.id, row.windows.map((w) => w.label)]),
    [['a', ['5-hour', 'Weekly']]],
  )
  const fiveHour = rows[0]?.windows[0]?.data.slice(-4).map((p) => p.value)

  // The lone empty 10:00 hour between two readings is bridged, so it is not drawn.
  assert.deepEqual(fiveHour, [null, 20, 35, null])
  // Everything before 09:00, and the hour in progress up to now.
  assert.deepEqual(
    rows[0]?.gaps.map((g) => [new Date(g.from).toISOString(), new Date(g.to).toISOString()]),
    [
      [new Date(quotaBuckets('7d', now)[0] ?? 0).toISOString(), '2026-10-09T09:00:00.000Z'],
      ['2026-10-09T12:00:00.000Z', new Date(now).toISOString()],
    ],
  )
})
