import { describe, expect, test } from 'bun:test'

import { rangeFilter, recentMonthKeys, resolveFinopsRange } from '@/lib/agent/finops-range'

const NOW = new Date('2026-08-08T13:45:00.000Z')

function iso(range: { since: Date; until: Date | null }) {
  return [range.since.toISOString(), range.until?.toISOString() ?? null]
}

describe('resolveFinopsRange', () => {
  test('mtd is the default and runs from the 1st to now', () => {
    for (const key of ['mtd', '', undefined]) {
      const range = resolveFinopsRange(key, NOW)

      expect(range && iso(range)).toEqual(['2026-08-01T00:00:00.000Z', null])
    }
  })

  // A closed month gets an upper bound so its total stops moving once it ends.
  test('last-month is bounded on both sides', () => {
    expect(iso(resolveFinopsRange('last-month', NOW)!)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
    ])
  })

  test('trailing windows include today', () => {
    expect(iso(resolveFinopsRange('7d', NOW)!)).toEqual(['2026-08-02T00:00:00.000Z', null])
    expect(iso(resolveFinopsRange('30d', NOW)!)).toEqual(['2026-07-10T00:00:00.000Z', null])
  })

  test('an explicit month covers exactly that month', () => {
    expect(iso(resolveFinopsRange('2026-02', NOW)!)).toEqual([
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ])
  })

  test('rejects anything it cannot resolve instead of falling back', () => {
    for (const key of ['2026-13', '2026-00', 'ytd', '90d', '2026', '2026-09', '2019-01', 'drop']) {
      expect(resolveFinopsRange(key, NOW)).toBeNull()
    }
  })
})

describe('rangeFilter', () => {
  test('omits the upper bound for an open range', () => {
    expect(rangeFilter(resolveFinopsRange('mtd', NOW)!)).toEqual({
      $gte: new Date('2026-08-01T00:00:00.000Z'),
    })
  })

  test('includes it for a closed one', () => {
    expect(rangeFilter(resolveFinopsRange('2026-02', NOW)!)).toEqual({
      $gte: new Date('2026-02-01T00:00:00.000Z'),
      $lt: new Date('2026-03-01T00:00:00.000Z'),
    })
  })
})

describe('recentMonthKeys', () => {
  test('counts back across a year boundary, newest first', () => {
    expect(recentMonthKeys(NOW, 3)).toEqual(['2026-08', '2026-07', '2026-06'])
    expect(recentMonthKeys(new Date('2026-01-15T00:00:00.000Z'), 3)).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
    ])
  })

  test('every key it offers resolves', () => {
    for (const key of recentMonthKeys(NOW)) {
      expect(resolveFinopsRange(key, NOW)).not.toBeNull()
    }
  })
})
