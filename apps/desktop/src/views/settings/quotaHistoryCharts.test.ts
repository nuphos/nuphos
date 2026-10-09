import assert from 'node:assert/strict'
import { test } from 'node:test'

import { quotaHistoryCharts } from './quotaHistoryCharts.ts'

import type { RuntimeInstance } from '../../types/runtime'

const agent = (id: string, label: string) => ({ id, label }) as RuntimeInstance

test('one chart per usage window, one line per agent, with gaps left empty', () => {
  const charts = quotaHistoryCharts(
    [
      {
        runtimeId: 'a',
        windowId: 'seven_day',
        label: 'Weekly',
        points: [{ at: '2026-10-09T10:00:00.000Z', usedPercent: 50 }],
      },
      {
        runtimeId: 'a',
        windowId: 'five_hour',
        label: '5-hour',
        points: [
          { at: '2026-10-09T10:00:00.000Z', usedPercent: 20 },
          { at: '2026-10-09T11:00:00.000Z', usedPercent: 35 },
        ],
      },
      {
        runtimeId: 'b',
        windowId: 'primary',
        label: '5-hour',
        points: [{ at: '2026-10-09T11:00:00.000Z', usedPercent: 60 }],
      },
      // An agent this caller no longer lists is left out.
      {
        runtimeId: 'gone',
        windowId: 'five_hour',
        label: '5-hour',
        points: [{ at: '2026-10-09T10:00:00.000Z', usedPercent: 99 }],
      },
    ],
    [agent('a', 'Claude'), agent('b', 'Codex')],
    '7d',
    Date.parse('2026-10-09T11:30:00.000Z'),
  )

  assert.deepEqual(
    charts.map((c) => [c.title, c.series]),
    [
      [
        '5-hour',
        [
          { key: 'a', label: 'Claude' },
          { key: 'b', label: 'Codex' },
        ],
      ],
      ['Weekly', [{ key: 'a', label: 'Claude' }]],
    ],
  )
  const data = charts[0]?.data ?? []

  // Seven days of hourly buckets, the empty ones included.
  assert.equal(data.length, 7 * 24 + 1)
  assert.deepEqual(
    data.slice(-3).map(({ a, b }) => [a, b]),
    [
      [null, null],
      [20, null],
      [35, 60],
    ],
  )
})
