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

test('a row per reporting agent, each bucket the busiest of its windows', () => {
  const rows = quotaHistoryRows(
    [
      {
        runtimeId: 'a',
        windowId: 'seven_day',
        label: 'Weekly',
        points: [
          { at: '2026-10-09T09:00:00.000Z', usedPercent: 40 },
          { at: '2026-10-09T11:00:00.000Z', usedPercent: 30 },
        ],
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
    rows.map((row) => row.instance.id),
    ['a'],
  )
  assert.equal(rows[0]?.peak.length, quotaBuckets('7d', now).length)
  // 09:00 and 11:00 take the higher window; 10:00 and the hour in progress read nothing.
  assert.deepEqual(
    rows[0]?.peak.slice(-4).map((p) => [new Date(p.at).toISOString(), p.value]),
    [
      ['2026-10-09T09:00:00.000Z', 40],
      ['2026-10-09T10:00:00.000Z', null],
      ['2026-10-09T11:00:00.000Z', 35],
      ['2026-10-09T12:00:00.000Z', null],
    ],
  )
})
