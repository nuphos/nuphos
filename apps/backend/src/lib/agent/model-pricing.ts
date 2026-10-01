import type { AgentTokenUsageProviderTotal, AgentTokenUsageSummary } from '@/lib/agent/token-usage'

// USD price per 1M tokens. cacheRead is the cache-read (cached input) rate —
// ~10% of the input rate. cacheWrite is the 5-minute-TTL cache-write rate —
// 1.25x the input rate, i.e. a PREMIUM, not a discount. Both are subsets of the
// reported inputTokens total, so only the remainder pays the plain input rate.
//
// Pricing cache writes at the input rate (what this table did before the four
// rates were split) under-billed the 2026-07-31..08-07 Vertex Opus 5 window by
// $73.99 against the GCP billing export: 58,777,038 cache-write tokens charged
// at $5/M instead of $6.25/M.
type ModelPrice = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

// Ordered most-specific-first: the resolver returns the first family whose key
// is a substring of the (normalized) modelId, so `opus-4-8` must precede the
// broader `opus-4`. Deployed model ids look like the Bedrock inference profile
// `us.anthropic.claude-opus-4-8-20260...-v1:0` or the bare `claude-opus-4-8`.
const MODEL_PRICES: [key: string, price: ModelPrice][] = [
  // Opus 5 cacheWrite 6.25 is the rate verified against the GCP Vertex SKU
  // export ("Claude Opus 5 5-minute cache write") for 2026-07-31..08-07.
  ['opus-5', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['opus-4-8', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['opus-4-7', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['opus-4-6', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['opus-4-5', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['opus-4-1', { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  ['opus-4', { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  // Sonnet 5 introductory pricing through 2026-08-31; reverts to 3 / 15 / 0.3.
  ['sonnet-5', { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  ['sonnet-4-6', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['sonnet-4-5', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['sonnet-4', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['haiku-4-5', { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
  ['haiku-3-5', { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }],
]

function priceForModel(modelId: string): ModelPrice | undefined {
  const normalized = modelId.toLowerCase()

  for (const [key, price] of MODEL_PRICES) {
    if (normalized.includes(key)) return price
  }

  return undefined
}

// The token fields cost is derived from — any rollup carrying a model id and
// per-kind token counts works (a full provider total, or an ad-hoc group row).
type PriceableUsage = {
  modelId: string
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
}

// Cost of a single provider+model rollup, or undefined when the model has no
// known price (so callers can tell "no data" from "$0"). Anthropic counts
// thinking tokens as output tokens already, so reasoningTokens is not added
// separately.
//
// inputTokens is the AI SDK's TOTAL prompt count — it already INCLUDES cache
// reads AND cache writes. Billing it whole at the input rate and then adding
// cachedInputTokens on top double-charged every cached token, overstating
// cache-heavy conversations ~2.5x (session 140c2120: shown $1.68, billed
// $0.66). So the three prompt classes are carved out of one total: cache reads
// and cache writes each pay their own rate, and only what is left pays the
// input rate. The clamp guards rollups where the sums come from different
// record subsets (and legacy rows with no cacheWriteTokens, which simply fall
// back to the pre-split behaviour of pricing writes as plain input).
export function providerCostUsd(provider: PriceableUsage): number | undefined {
  const price = priceForModel(provider.modelId)

  if (!price) return undefined
  const inputTokens = provider.inputTokens ?? 0
  const outputTokens = provider.outputTokens ?? 0
  const cachedInputTokens = provider.cachedInputTokens ?? 0
  const cacheWriteTokens = provider.cacheWriteTokens ?? 0
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens)

  return (
    (uncachedInputTokens * price.input +
      outputTokens * price.output +
      cachedInputTokens * price.cacheRead +
      cacheWriteTokens * price.cacheWrite) /
    1_000_000
  )
}

// Total cost across all priced models. Returns undefined only when no model in
// the conversation has a known price.
export function totalCostUsd(providers: AgentTokenUsageProviderTotal[]): number | undefined {
  let total = 0
  let priced = false

  for (const provider of providers) {
    const cost = providerCostUsd(provider)

    if (cost != null) {
      total += cost
      priced = true
    }
  }

  return priced ? total : undefined
}

// Recompute costs from the token breakdown that is already persisted on every
// conversation, so all history (not just new turns) shows a price, and a change
// to the pricing table above takes effect immediately without a backfill.
export function withCostUsd(summary: AgentTokenUsageSummary): AgentTokenUsageSummary {
  const providers = summary.providers.map((provider) => ({
    ...provider,
    costUsd: providerCostUsd(provider),
  }))

  return { ...summary, providers, costUsd: totalCostUsd(providers) }
}
