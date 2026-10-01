// A single model call writes several records (step_total + input + output +
// thinking), so each token field is summed only from the record kind that owns
// it — mirroring refreshConversationTokenUsageSummary — or totals double count.
export const KIND_TOKEN_SUMS = {
  inputTokens: {
    $sum: { $cond: [{ $eq: ['$kind', 'input'] }, { $ifNull: ['$tokens.inputTokens', 0] }, 0] },
  },
  cachedInputTokens: {
    $sum: {
      $cond: [{ $eq: ['$kind', 'input'] }, { $ifNull: ['$tokens.cachedInputTokens', 0] }, 0],
    },
  },
  // Cache writes bill at a premium (1.25x input), so they are summed as their
  // own class rather than folded into inputTokens.
  cacheWriteTokens: {
    $sum: {
      $cond: [{ $eq: ['$kind', 'input'] }, { $ifNull: ['$tokens.cacheWriteTokens', 0] }, 0],
    },
  },
  outputTokens: {
    $sum: { $cond: [{ $eq: ['$kind', 'output'] }, { $ifNull: ['$tokens.outputTokens', 0] }, 0] },
  },
  totalTokens: {
    $sum: {
      $cond: [{ $eq: ['$kind', 'step_total'] }, { $ifNull: ['$tokens.totalTokens', 0] }, 0],
    },
  },
} as const

// The token side of one (bucket × provider × model) group, before pricing.
export type UsageTokenRow = {
  provider: string
  modelId: string
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  totalTokens: number
}
