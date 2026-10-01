import { describe, expect, test } from 'bun:test'

import { mergeTrend, windowCounts } from './overview'

describe('admin overview helpers', () => {
  test('fills missing trend days and combines duplicate daily activation rows', () => {
    expect(
      mergeTrend(
        new Date('2026-08-01T00:00:00.000Z'),
        3,
        [{ date: '2026-08-01', count: 2 }],
        [{ date: '2026-08-03', count: 1 }],
        [
          { date: '2026-08-02', count: 1 },
          { date: '2026-08-02', count: 2 },
        ],
      ),
    ).toEqual([
      { date: '2026-08-01', newUsers: 2, newWorkspaces: 0, firstAgentUsers: 0 },
      { date: '2026-08-02', newUsers: 0, newWorkspaces: 0, firstAgentUsers: 3 },
      { date: '2026-08-03', newUsers: 0, newWorkspaces: 1, firstAgentUsers: 0 },
    ])
  })

  test('counts calendar windows inclusively from their UTC boundary', () => {
    const dates = [
      new Date('2026-08-11T00:00:00.000Z'),
      new Date('2026-08-10T23:59:59.999Z'),
      new Date('2026-08-05T00:00:00.000Z'),
      new Date('2026-07-13T00:00:00.000Z'),
      new Date('2026-07-12T23:59:59.999Z'),
    ]

    expect(
      windowCounts(
        dates,
        new Date('2026-08-11T00:00:00.000Z'),
        new Date('2026-08-05T00:00:00.000Z'),
        new Date('2026-07-13T00:00:00.000Z'),
      ),
    ).toEqual({ today: 1, last7d: 3, last30d: 4 })
  })
})
