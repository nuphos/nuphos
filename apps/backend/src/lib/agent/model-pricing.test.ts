import { describe, expect, test } from 'bun:test'

import { providerCostUsd, totalCostUsd } from './model-pricing'

describe('providerCostUsd', () => {
  test('bills only the uncached remainder at the input rate', () => {
    // inputTokens is the AI SDK total (noCache + cacheRead + cacheWrite).
    // 100k total of which 80k cached: 20k @ $5 + 80k @ $0.5 + 1k out @ $25.
    const cost = providerCostUsd({
      modelId: 'global.anthropic.claude-opus-4-8',
      inputTokens: 100_000,
      outputTokens: 1_000,
      cachedInputTokens: 80_000,
    })

    expect(cost).toBeCloseTo((20_000 * 5 + 80_000 * 0.5 + 1_000 * 25) / 1e6, 10)
  })

  test('regression: cache-heavy conversation is no longer double-charged (session 140c2120)', () => {
    // Real rollup that rendered as $1.68 pre-fix (309,812 input tokens billed
    // whole at $5 PLUS 217,064 cached billed again at $0.5).
    const cost = providerCostUsd({
      modelId: 'global.anthropic.claude-opus-4-8',
      inputTokens: 309_812,
      outputTokens: 941,
      cachedInputTokens: 217_064,
    })!

    expect(cost).toBeCloseTo((92_748 * 5 + 217_064 * 0.5 + 941 * 25) / 1e6, 10) // ≈ $0.60
    expect(cost).toBeLessThan(1)
  })

  test('clamps when cachedInputTokens exceeds inputTokens (mismatched record subsets)', () => {
    const cost = providerCostUsd({
      modelId: 'claude-opus-4-8',
      inputTokens: 1_000,
      outputTokens: 0,
      cachedInputTokens: 5_000,
    })

    expect(cost).toBeCloseTo((5_000 * 0.5) / 1e6, 10)
  })

  test('no cache activity behaves as before', () => {
    const cost = providerCostUsd({
      modelId: 'claude-haiku-4-5',
      inputTokens: 10_000,
      outputTokens: 2_000,
    })

    expect(cost).toBeCloseTo((10_000 * 1 + 2_000 * 5) / 1e6, 10)
  })

  test('unknown model returns undefined, not 0', () => {
    expect(providerCostUsd({ modelId: 'gemini-2.5-flash-lite', inputTokens: 1000 })).toBeUndefined()
  })

  test('bills cache writes at the 5-minute cache-write rate, not the input rate', () => {
    // 100k prompt = 20k uncached + 50k cache read + 30k cache write.
    const cost = providerCostUsd({
      modelId: 'claude-opus-5',
      inputTokens: 100_000,
      outputTokens: 1_000,
      cachedInputTokens: 50_000,
      cacheWriteTokens: 30_000,
    })

    expect(cost).toBeCloseTo((20_000 * 5 + 50_000 * 0.5 + 30_000 * 6.25 + 1_000 * 25) / 1e6, 10)
  })

  test('reconciles the 2026-07-31..08-07 Vertex Opus 5 window against BigQuery', () => {
    // Verified GCP SKU rates: uncached $5/M, cache read $0.5/M,
    // 5-minute cache write $6.25/M, output $25/M. BigQuery cost for the same
    // window was $844.727509 — a rounding-level match.
    const uncached = 39_480_408
    const cacheRead = 417_763_199
    const cacheWrite = 58_777_038
    const output = 2_843_501
    const cost = providerCostUsd({
      modelId: 'claude-opus-5',
      inputTokens: uncached + cacheRead + cacheWrite,
      outputTokens: output,
      cachedInputTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    })!

    expect(cost).toBeCloseTo(844.727652, 6)
    expect(Math.abs(cost - 844.727509)).toBeLessThan(0.001)
  })

  test('clamps when cache read + cache write exceed inputTokens', () => {
    const cost = providerCostUsd({
      modelId: 'claude-opus-5',
      inputTokens: 1_000,
      outputTokens: 0,
      cachedInputTokens: 5_000,
      cacheWriteTokens: 4_000,
    })

    expect(cost).toBeCloseTo((5_000 * 0.5 + 4_000 * 6.25) / 1e6, 10)
  })

  test('legacy rows without cacheWriteTokens price exactly as before', () => {
    const cost = providerCostUsd({
      modelId: 'claude-opus-5',
      inputTokens: 100_000,
      outputTokens: 1_000,
      cachedInputTokens: 80_000,
    })

    expect(cost).toBeCloseTo((20_000 * 5 + 80_000 * 0.5 + 1_000 * 25) / 1e6, 10)
  })

  test('reasoning tokens are already inside outputTokens and are not billed twice', () => {
    const withReasoning = providerCostUsd({
      modelId: 'claude-opus-5',
      inputTokens: 1_000,
      outputTokens: 2_000,
      reasoningTokens: 1_500,
    } as never)
    const withoutReasoning = providerCostUsd({
      modelId: 'claude-opus-5',
      inputTokens: 1_000,
      outputTokens: 2_000,
    })

    expect(withReasoning).toBe(withoutReasoning)
  })
})

describe('totalCostUsd', () => {
  test('sums priced models and ignores unpriced ones; all-unpriced is undefined', () => {
    const priced = {
      provider: 'bedrock',
      modelId: 'claude-opus-4-8',
      inputTokens: 100_000,
      outputTokens: 0,
      cachedInputTokens: 100_000,
    }
    const unpriced = { provider: 'google', modelId: 'gemini-2.5-flash-lite', inputTokens: 1e9 }

    expect(totalCostUsd([priced, unpriced] as never)).toBeCloseTo((100_000 * 0.5) / 1e6, 10)
    expect(totalCostUsd([unpriced] as never)).toBeUndefined()
  })
})

describe('cache-write rate is input x 1.25 across the whole table', () => {
  // Confirmed against the GCP billing export on two model generations, so this
  // is a property of the SKU ("Input Cache Write Tokens (TTL 300 seconds)"),
  // not an Opus-5 special case: 2026-07-15 Opus 4.8 billed $1.663312 for
  // 84,587 / 2,293 / 2,293 / 48,996, and 84,587*5 + 2,293*0.5 + 2,293*6.25 +
  // 48,996*25 = 1.66331275 exactly.
  test('every priced model charges 1.25x input for a cache write', () => {
    for (const modelId of [
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-1',
      'claude-sonnet-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-haiku-3-5',
    ]) {
      const inputOnly = providerCostUsd({ modelId, inputTokens: 1_000_000 })!
      const writeOnly = providerCostUsd({
        modelId,
        inputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      })!

      expect(writeOnly).toBeCloseTo(inputOnly * 1.25, 10)
    }
  })

  test('reproduces the reconciled Opus 4.8 billing-export row to the cent', () => {
    const cost = providerCostUsd({
      modelId: 'claude-opus-4-8',
      inputTokens: 84_587 + 2_293 + 2_293,
      outputTokens: 48_996,
      cachedInputTokens: 2_293,
      cacheWriteTokens: 2_293,
    })!

    expect(cost).toBeCloseTo(1.66331275, 8)
  })

  test('reproduces the 2026-07-31..08-07 Mongo window and its $73.99 shortfall', () => {
    const uncached = 29_340_704
    const cacheRead = 424_976_207
    const cacheWrite = 59_192_153
    const output = 2_400_177
    const usage = {
      modelId: 'claude-opus-5',
      inputTokens: uncached + cacheRead + cacheWrite,
      outputTokens: output,
      cachedInputTokens: cacheRead,
    }
    const corrected = providerCostUsd({ ...usage, cacheWriteTokens: cacheWrite })!
    // What the pre-split table produced (cache writes at the plain input rate),
    // which matched the UI to the last digit.
    const before = providerCostUsd(usage)!

    expect(corrected).toBeCloseTo(789.147005, 5)
    expect(before).toBeCloseTo(715.156813, 5)
    expect(corrected - before).toBeCloseTo((1.25 * cacheWrite) / 1e6, 6)
    expect(corrected - before).toBeCloseTo(73.990191, 5)
  })
})
