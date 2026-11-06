import { describe, expect, test } from 'bun:test'

import { normalizeTokenUsage } from './token-usage'

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
