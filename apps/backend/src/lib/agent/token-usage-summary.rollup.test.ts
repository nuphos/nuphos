import { describe, expect, test } from 'bun:test'

import { providerCostUsd, withCostUsd } from './model-pricing'
import { tokenUsageSummaryFromAggregation, tokenUsageSummaryPipeline } from './token-usage-summary'
import { KIND_TOKEN_SUMS } from './usage-aggregation'

// The conversation rollup sums each token class only from the record kind that
// owns it (a model call writes step_total + input + output + thinking rows), so
// cache writes must be summed from the `input` rows — the same rows that carry
// inputTokens and cachedInputTokens.
describe('tokenUsageSummaryPipeline', () => {
  const facet = (tokenUsageSummaryPipeline('s', 'u')[1] as any).$facet

  test('totals sum cacheWriteTokens from the input rows only', () => {
    const group = facet.totals[0].$group

    expect(group.cacheWriteTokens).toEqual({
      $sum: {
        $cond: [{ $eq: ['$kind', 'input'] }, { $ifNull: ['$tokens.cacheWriteTokens', 0] }, 0],
      },
    })
    expect(group.cacheWriteTokenRecordCount).toBeDefined()
  })

  test('per-provider rollup sums cacheWriteTokens from its step_total rows', () => {
    const providerStage = facet.providers[1].$group

    expect(providerStage.cacheWriteTokens).toEqual({
      $sum: { $ifNull: ['$tokens.cacheWriteTokens', 0] },
    })
    expect(facet.providers[2].$project.cacheWriteTokens).toBe(1)
  })
})

describe('tokenUsageSummaryFromAggregation', () => {
  const aggregation = {
    totals: [
      {
        recordCount: 4,
        modelCallCount: 1,
        toolCallCount: 0,
        inputTokens: 100_000,
        inputTokenRecordCount: 1,
        outputTokens: 1_000,
        outputTokenRecordCount: 1,
        reasoningTokens: 0,
        reasoningTokenRecordCount: 0,
        totalTokens: 101_000,
        totalTokenRecordCount: 1,
        cachedInputTokens: 50_000,
        cachedInputTokenRecordCount: 1,
        cacheWriteTokens: 30_000,
        cacheWriteTokenRecordCount: 1,
      },
    ],
    providers: [
      {
        provider: 'vertex.anthropic',
        modelId: 'claude-opus-5',
        recordCount: 1,
        inputTokens: 100_000,
        inputTokenRecordCount: 1,
        outputTokens: 1_000,
        outputTokenRecordCount: 1,
        reasoningTokens: 0,
        reasoningTokenRecordCount: 0,
        totalTokens: 101_000,
        totalTokenRecordCount: 1,
        cachedInputTokens: 50_000,
        cachedInputTokenRecordCount: 1,
        cacheWriteTokens: 30_000,
        cacheWriteTokenRecordCount: 1,
      },
    ],
  }

  test('carries cacheWriteTokens onto the summary and every provider total', () => {
    const summary = tokenUsageSummaryFromAggregation(aggregation)!

    expect(summary.cacheWriteTokens).toBe(30_000)
    expect(summary.providers[0]!.cacheWriteTokens).toBe(30_000)
  })

  test('the cost the UI renders matches the four-class SKU formula', () => {
    const summary = withCostUsd(tokenUsageSummaryFromAggregation(aggregation)!)

    expect(summary.costUsd).toBeCloseTo(
      (20_000 * 5 + 50_000 * 0.5 + 30_000 * 6.25 + 1_000 * 25) / 1e6,
      10,
    )
  })

  test('a conversation with no cache-write rows leaves the field unset', () => {
    const noWrites = {
      totals: [{ ...aggregation.totals[0]!, cacheWriteTokens: 0, cacheWriteTokenRecordCount: 0 }],
      providers: [
        { ...aggregation.providers[0]!, cacheWriteTokens: 0, cacheWriteTokenRecordCount: 0 },
      ],
    }
    const summary = tokenUsageSummaryFromAggregation(noWrites)!

    expect(summary.cacheWriteTokens).toBeUndefined()
    expect('cacheWriteTokens' in summary.providers[0]!).toBe(false)
  })
})

describe('team usage aggregation (KIND_TOKEN_SUMS)', () => {
  test('sums cacheWriteTokens from the input rows so team cost uses one formula', () => {
    expect((KIND_TOKEN_SUMS as any).cacheWriteTokens).toEqual({
      $sum: {
        $cond: [{ $eq: ['$kind', 'input'] }, { $ifNull: ['$tokens.cacheWriteTokens', 0] }, 0],
      },
    })
  })

  test('the team-usage row shape prices through providerCostUsd unchanged', () => {
    const row = {
      modelId: 'claude-opus-5',
      inputTokens: 100_000,
      outputTokens: 1_000,
      cachedInputTokens: 50_000,
      cacheWriteTokens: 30_000,
    }

    expect(providerCostUsd(row)).toBeCloseTo(
      (20_000 * 5 + 50_000 * 0.5 + 30_000 * 6.25 + 1_000 * 25) / 1e6,
      10,
    )
  })
})
