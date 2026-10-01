import type { AgentTokenUsageTokens } from './token-usage-db'

// Pulls our five token classes out of whatever usage shape the caller has.
// Three live upstream at once and all three must be understood:
//   - AI SDK v6 (`ai` package): flat inputTokens/outputTokens/totalTokens plus
//     the nested inputTokenDetails.{cacheReadTokens,cacheWriteTokens} and
//     outputTokenDetails.reasoningTokens (the flat cachedInputTokens /
//     reasoningTokens fields are deprecated aliases of those).
//   - the provider's own body, echoed back under `raw` (and stored on our rows
//     inside rawUsage): Anthropic's snake_case input_tokens /
//     cache_read_input_tokens / cache_creation_input_tokens / output_tokens.
//   - a bare Anthropic body passed directly (what the backfill reads).
// Anthropic's `input_tokens` is the UNCACHED remainder only, while our
// inputTokens is the total — so when the count comes from the snake_case shape
// the cache classes are added back in, keeping
// inputTokens = uncached + cacheRead + cacheWrite everywhere.
export function normalizeTokenUsage(usage: unknown): AgentTokenUsageTokens {
  if (!usage || typeof usage !== 'object') return {}
  const raw = usage as Record<string, unknown>
  const inputDetails = objectValue(raw.inputTokenDetails)
  const outputDetails = objectValue(raw.outputTokenDetails)
  const providerRaw = objectValue(raw.raw) ?? {}

  const cachedInputTokens = firstTokenValue(
    raw.cachedInputTokens,
    inputDetails?.cacheReadTokens,
    raw.cachedPromptTokens,
    raw.cachedContentTokenCount,
    raw.cache_read_input_tokens,
    providerRaw.cache_read_input_tokens,
    raw.cacheReadInputTokens,
    providerRaw.cacheReadInputTokens,
  )
  // inputTokenDetails first, deliberately: it is the ONE field present and
  // correct on both providers. The native names diverge — Vertex
  // `cache_creation_input_tokens`, Bedrock `cacheWriteInputTokens` — so keying
  // off either native path alone would fix only half the fleet.
  const cacheWriteTokens = firstTokenValue(
    inputDetails?.cacheWriteTokens,
    raw.cacheWriteTokens,
    raw.cacheCreationInputTokens,
    raw.cacheCreationTokens,
    raw.cache_creation_input_tokens,
    providerRaw.cache_creation_input_tokens,
    raw.cacheWriteInputTokens,
    providerRaw.cacheWriteInputTokens,
  )
  const totalInputTokens = firstTokenValue(raw.inputTokens, raw.promptTokens, raw.promptTokenCount)
  const uncachedInputTokens = firstTokenValue(
    inputDetails?.noCacheTokens,
    raw.input_tokens,
    providerRaw.input_tokens,
  )

  return {
    ...normalizeTokenField(
      totalInputTokens ?? sumTokenValues(uncachedInputTokens, cachedInputTokens, cacheWriteTokens),
      'inputTokens',
    ),
    ...normalizeTokenField(
      firstTokenValue(
        raw.outputTokens,
        raw.completionTokens,
        raw.candidatesTokenCount,
        raw.output_tokens,
        providerRaw.output_tokens,
      ),
      'outputTokens',
    ),
    ...normalizeTokenField(
      firstTokenValue(
        raw.reasoningTokens,
        outputDetails?.reasoningTokens,
        raw.thinkingTokens,
        raw.thoughtsTokenCount,
      ),
      'reasoningTokens',
    ),
    ...normalizeTokenField(firstTokenValue(raw.totalTokens, raw.totalTokenCount), 'totalTokens'),
    ...normalizeTokenField(cachedInputTokens, 'cachedInputTokens'),
    ...normalizeTokenField(cacheWriteTokens, 'cacheWriteTokens'),
  }
}

function normalizeTokenField(
  value: unknown,
  key: keyof AgentTokenUsageTokens,
): Partial<AgentTokenUsageTokens> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return {}

  return { [key]: Math.max(0, Math.trunc(value)) }
}

function firstTokenValue(...values: unknown[]): unknown {
  return values.find((value) => typeof value === 'number' && Number.isFinite(value))
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function sumTokenValues(...values: unknown[]): number | undefined {
  let total = 0
  let seen = false

  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    total += value
    seen = true
  }

  return seen ? total : undefined
}

// Pricing carries ONE cache-write rate — input x 1.25, the 5-minute TTL — which
// is what every row in our history has ever used (Vertex
// ephemeral_1h_input_tokens is 0 throughout; every Bedrock cacheDetails ttl is
// '5m'). A 1-hour cache write bills at 2x input, so if one ever appears the
// table under-bills it by 60% with nothing to show for it. This is the tripwire:
// callers log loudly rather than quietly mispricing.
export function hasNonFiveMinuteCacheWrite(usage: unknown): boolean {
  const providerRaw = objectValue(objectValue(usage)?.raw)

  if (!providerRaw) return false
  const cacheCreation = objectValue(providerRaw.cache_creation)

  for (const [key, value] of Object.entries(cacheCreation ?? {})) {
    if (key === 'ephemeral_5m_input_tokens') continue
    if (typeof value === 'number' && value > 0) return true
  }
  const cacheDetails = providerRaw.cacheDetails

  if (!Array.isArray(cacheDetails)) return false

  return cacheDetails.some((detail) => {
    const ttl = objectValue(detail)?.ttl

    return typeof ttl === 'string' && ttl !== '5m'
  })
}
