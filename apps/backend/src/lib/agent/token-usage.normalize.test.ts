import { describe, expect, test } from 'bun:test'

import {
  hasNonFiveMinuteCacheWrite,
  makeTokenUsageRecordsForModelCall,
  normalizeTokenUsage,
} from './token-usage'

describe('normalizeTokenUsage cache-write extraction', () => {
  test('reads the AI SDK nested inputTokenDetails.cacheWriteTokens', () => {
    const tokens = normalizeTokenUsage({
      inputTokens: 100_000,
      outputTokens: 1_000,
      totalTokens: 101_000,
      cachedInputTokens: 50_000,
      inputTokenDetails: { cacheReadTokens: 50_000, cacheWriteTokens: 30_000 },
    })

    expect(tokens.inputTokens).toBe(100_000)
    expect(tokens.cachedInputTokens).toBe(50_000)
    expect(tokens.cacheWriteTokens).toBe(30_000)
  })

  test('reads cache reads from inputTokenDetails when cachedInputTokens is absent', () => {
    const tokens = normalizeTokenUsage({
      inputTokens: 100_000,
      outputTokens: 1_000,
      inputTokenDetails: { cacheReadTokens: 50_000, cacheWriteTokens: 30_000 },
    })

    expect(tokens.cachedInputTokens).toBe(50_000)
    expect(tokens.cacheWriteTokens).toBe(30_000)
  })

  test('reads the flat provider alias cacheCreationInputTokens', () => {
    const tokens = normalizeTokenUsage({
      inputTokens: 10_000,
      outputTokens: 50,
      cachedInputTokens: 4_000,
      cacheCreationInputTokens: 2_000,
    })

    expect(tokens.cacheWriteTokens).toBe(2_000)
  })

  test('reads the raw Anthropic snake_case shape and rebuilds the total prompt count', () => {
    // Anthropic's native body reports input_tokens as the UNCACHED remainder
    // only; inputTokens on our rows is uncached + cacheRead + cacheWrite.
    const tokens = normalizeTokenUsage({
      input_tokens: 39_480,
      cache_read_input_tokens: 417_763,
      cache_creation_input_tokens: 58_777,
      output_tokens: 2_843,
    })

    expect(tokens.cachedInputTokens).toBe(417_763)
    expect(tokens.cacheWriteTokens).toBe(58_777)
    expect(tokens.outputTokens).toBe(2_843)
    expect(tokens.inputTokens).toBe(39_480 + 417_763 + 58_777)
  })

  test('falls back to the AI SDK `raw` provider usage bag', () => {
    // What the AI SDK actually persists on our rows: the standard fields plus a
    // nested `raw` copy of Anthropic's own body.
    const tokens = normalizeTokenUsage({
      inputTokens: 516_020,
      outputTokens: 2_843,
      totalTokens: 518_863,
      cachedInputTokens: 417_763,
      raw: {
        input_tokens: 39_480,
        cache_read_input_tokens: 417_763,
        cache_creation_input_tokens: 58_777,
        output_tokens: 2_843,
      },
    })

    expect(tokens.inputTokens).toBe(516_020)
    expect(tokens.cachedInputTokens).toBe(417_763)
    expect(tokens.cacheWriteTokens).toBe(58_777)
  })

  test('omits cacheWriteTokens entirely when the provider reported none', () => {
    const tokens = normalizeTokenUsage({ inputTokens: 10, outputTokens: 2 })

    expect('cacheWriteTokens' in tokens).toBe(false)
  })

  test('keeps a reported zero cache write as 0', () => {
    const tokens = normalizeTokenUsage({
      inputTokens: 10,
      outputTokens: 2,
      inputTokenDetails: { cacheWriteTokens: 0 },
    })

    expect(tokens.cacheWriteTokens).toBe(0)
  })
})

describe('makeTokenUsageRecordsForModelCall cache-write persistence', () => {
  const args = {
    recordPrefix: 'stream:req:step:0',
    sessionId: 'session-1',
    userId: 'user-1',
    teamId: 'team-1',
    operation: 'chat',
    source: 'ai-sdk' as const,
    provider: 'vertex.anthropic',
    modelId: 'claude-opus-5',
    usage: {
      inputTokens: 100_000,
      outputTokens: 1_000,
      totalTokens: 101_000,
      cachedInputTokens: 50_000,
      inputTokenDetails: { cacheReadTokens: 50_000, cacheWriteTokens: 30_000 },
    },
    createdAt: new Date('2026-08-01T00:00:00Z'),
  }

  test('step_total and input rows both persist cacheWriteTokens', () => {
    const records = makeTokenUsageRecordsForModelCall(args)
    const stepTotal = records.find((r) => r.kind === 'step_total')!
    const input = records.find((r) => r.kind === 'input')!

    expect(stepTotal.tokens.cacheWriteTokens).toBe(30_000)
    expect(input.tokens.cacheWriteTokens).toBe(30_000)
  })

  test('frozen providerCostUsd prices the cache write at the cache-write rate', () => {
    const stepTotal = makeTokenUsageRecordsForModelCall(args).find((r) => r.kind === 'step_total')!

    expect(stepTotal.providerCostUsd).toBeCloseTo(
      (20_000 * 5 + 50_000 * 0.5 + 30_000 * 6.25 + 1_000 * 25) / 1e6,
      10,
    )
  })
})

describe('cache-write TTL is 5-minute only', () => {
  // Pricing assumes ONE cache-write rate: input x 1.25, the 5-minute TTL. A
  // 1-hour cache write is billed at 2x input, so if one ever appears the table
  // silently under-bills it by 60%. Verified across all history today: Vertex
  // ephemeral_1h_input_tokens = 0, every Bedrock cacheDetails ttl = '5m'.
  test('detects a Vertex 1-hour cache write', () => {
    expect(
      hasNonFiveMinuteCacheWrite({
        raw: { cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 20 } },
      }),
    ).toBe(true)
  })

  test('detects a Bedrock non-5m cache TTL', () => {
    expect(hasNonFiveMinuteCacheWrite({ raw: { cacheDetails: [{ ttl: '1h' }] } })).toBe(true)
  })

  test('the shapes we actually see today are all 5-minute', () => {
    expect(
      hasNonFiveMinuteCacheWrite({
        raw: { cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 } },
      }),
    ).toBe(false)
    expect(
      hasNonFiveMinuteCacheWrite({ raw: { cacheDetails: [{ ttl: '5m' }, { ttl: '5m' }] } }),
    ).toBe(false)
    expect(hasNonFiveMinuteCacheWrite({ inputTokens: 10, outputTokens: 2 })).toBe(false)
    expect(hasNonFiveMinuteCacheWrite(undefined)).toBe(false)
  })
})

describe('Bedrock cache-write aliases', () => {
  test('reads the nested inputTokenDetails on Bedrock rows, whose raw name differs', () => {
    // Bedrock spells it cacheWriteInputTokens, Vertex cache_creation_input_tokens;
    // inputTokenDetails is the one field present and correct on BOTH.
    const tokens = normalizeTokenUsage({
      inputTokens: 100_000,
      outputTokens: 1_000,
      inputTokenDetails: { cacheReadTokens: 50_000, cacheWriteTokens: 30_000 },
      raw: { cacheWriteInputTokens: 30_000, cacheReadInputTokens: 50_000 },
    })

    expect(tokens.cacheWriteTokens).toBe(30_000)
  })

  test('falls back to the Bedrock raw name when the details bag is missing', () => {
    const tokens = normalizeTokenUsage({
      inputTokens: 100_000,
      outputTokens: 1_000,
      raw: { cacheWriteInputTokens: 30_000, cacheReadInputTokens: 50_000 },
    })

    expect(tokens.cacheWriteTokens).toBe(30_000)
    expect(tokens.cachedInputTokens).toBe(50_000)
  })
})

describe('a 1-hour cache write is reported, not silently mispriced', () => {
  test('makeTokenUsageRecordsForModelCall logs when it sees a non-5m TTL', () => {
    const seen: unknown[] = []
    const records = makeTokenUsageRecordsForModelCall({
      recordPrefix: 'p',
      sessionId: 's',
      userId: 'u',
      operation: 'chat',
      source: 'ai-sdk',
      provider: 'vertex.anthropic',
      modelId: 'claude-opus-5',
      usage: {
        inputTokens: 1_000,
        outputTokens: 10,
        inputTokenDetails: { cacheWriteTokens: 100 },
        raw: { cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100 } },
      },
      onUnexpectedCacheTtl: (info) => seen.push(info),
    })

    expect(records.length).toBeGreaterThan(0) // still recorded, just flagged
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ modelId: 'claude-opus-5', cacheWriteTokens: 100 })
  })

  test('the ordinary 5m case never fires the tripwire', () => {
    const seen: unknown[] = []

    makeTokenUsageRecordsForModelCall({
      recordPrefix: 'p',
      sessionId: 's',
      userId: 'u',
      operation: 'chat',
      source: 'ai-sdk',
      provider: 'vertex.anthropic',
      modelId: 'claude-opus-5',
      usage: {
        inputTokens: 1_000,
        outputTokens: 10,
        inputTokenDetails: { cacheWriteTokens: 100 },
        raw: { cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 } },
      },
      onUnexpectedCacheTtl: (info) => seen.push(info),
    })

    expect(seen).toEqual([])
  })
})

describe('the default TTL reporter is wired, not a dangling reference', () => {
  test('omitting onUnexpectedCacheTtl still records the row without throwing', () => {
    const records = makeTokenUsageRecordsForModelCall({
      recordPrefix: 'p',
      sessionId: 's',
      userId: 'u',
      operation: 'chat',
      source: 'ai-sdk',
      provider: 'vertex.anthropic',
      modelId: 'claude-opus-5',
      usage: {
        inputTokens: 1_000,
        outputTokens: 10,
        inputTokenDetails: { cacheWriteTokens: 100 },
        raw: { cache_creation: { ephemeral_1h_input_tokens: 100 } },
      },
    })

    expect(records.find((r) => r.kind === 'step_total')!.tokens.cacheWriteTokens).toBe(100)
  })
})
