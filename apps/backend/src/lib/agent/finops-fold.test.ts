import { describe, expect, test } from 'bun:test'

import { foldByKey, foldTotals } from '@/lib/agent/finops-fold'

import type { KeyedUsageTokenRow } from '@/lib/agent/finops-fold'

function row(over: Partial<KeyedUsageTokenRow> = {}): KeyedUsageTokenRow {
  return {
    key: 'team-a',
    provider: 'vertex',
    modelId: 'claude-opus-5',
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    ...over,
  }
}

// Opus 5: input 5, cacheRead 0.5, output 25 per 1M.
describe('foldTotals prices per model, not on the summed bucket', () => {
  test('charges cache reads at the cache rate, not the input rate', () => {
    const totals = foldTotals([
      row({ inputTokens: 1_000_000, cachedInputTokens: 800_000, outputTokens: 100_000 }),
    ])

    // 200k uncached @5 + 800k cached @0.5 + 100k output @25.
    expect(totals.costUsd).toBeCloseTo(1 + 0.4 + 2.5, 10)
    expect(totals.hasUnpricedModel).toBe(false)
  })

  test('two models are priced separately and then added', () => {
    const totals = foldTotals([
      row({ inputTokens: 1_000_000 }),
      row({ modelId: 'claude-haiku-4-5', inputTokens: 1_000_000 }),
    ])

    expect(totals.costUsd).toBeCloseTo(5 + 1, 10)
  })

  // Summing the two models first and pricing once would have charged the
  // second model's tokens at the first model's rate.
  test('an unknown model contributes tokens but flags the total as a floor', () => {
    const totals = foldTotals([
      row({ inputTokens: 1_000_000 }),
      row({ modelId: 'some-future-model', inputTokens: 2_000_000 }),
    ])

    expect(totals.costUsd).toBeCloseTo(5, 10)
    expect(totals.inputTokens).toBe(3_000_000)
    expect(totals.hasUnpricedModel).toBe(true)
  })
})

// Cache writes bill at 1.25x input (Opus 5: 6.25 vs 5). They arrive as their
// own token class, and a rollup that forgets to carry the field prices them at
// zero — the exact under-count the billed-vs-derived comparison exists to
// surface, so it is worth pinning here rather than noticing it on the page.
describe('cache writes are priced as their own class', () => {
  test('charges the cache-write premium, not the input rate', () => {
    const totals = foldTotals([row({ cacheWriteTokens: 1_000_000 })])

    expect(totals.costUsd).toBeCloseTo(6.25, 10)
    expect(totals.cacheWriteTokens).toBe(1_000_000)
  })

  test('a bucket with only cache writes is not free', () => {
    const rows = foldByKey([row({ key: 'team-a', cacheWriteTokens: 400_000 })])

    expect(rows[0]?.costUsd).toBeGreaterThan(0)
  })
})

describe('foldByKey', () => {
  test('groups by bucket and sorts most expensive first', () => {
    const rows = foldByKey([
      row({ key: 'team-a', outputTokens: 100_000 }),
      row({ key: 'team-b', outputTokens: 400_000 }),
      row({ key: 'team-a', outputTokens: 100_000 }),
    ])

    expect(rows.map((r) => r.key)).toEqual(['team-b', 'team-a'])
    expect(rows[0]?.costUsd).toBeCloseTo(10, 10)
    expect(rows[1]?.costUsd).toBeCloseTo(5, 10)
    expect(rows[1]?.outputTokens).toBe(200_000)
  })

  test('keeps the no-team bucket instead of dropping it', () => {
    const rows = foldByKey([row({ key: '', outputTokens: 40_000 })])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe('')
  })
})
