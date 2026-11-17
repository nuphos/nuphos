// What the deterministic agent reports for an E2E_TURN_USAGE turn.

// PromptResponse.usage in claude-agent-acp 0.74.0's shape: `inputTokens` is the uncached part.
export const CLAUDE_TURN_USAGE = {
  inputTokens: 12,
  outputTokens: 900,
  cachedReadTokens: 250_000,
  cachedWriteTokens: 8000,
  totalTokens: 258_912,
}
// Its `_meta.quota`: the model rows also count a Task sub-agent the main-loop usage leaves out.
export const CLAUDE_TURN_QUOTA = {
  token_count: { ...CLAUDE_TURN_USAGE, cachedInputTokens: 250_000, reasoningOutputTokens: 0 },
  model_usage: [
    {
      model: 'claude-opus-5-5',
      token_count: {
        totalTokens: 258_912,
        inputTokens: 12,
        cachedInputTokens: 250_000,
        cachedWriteTokens: 8000,
        outputTokens: 900,
        reasoningOutputTokens: 0,
      },
    },
    {
      model: 'claude-haiku-5-5',
      token_count: {
        totalTokens: 31_400,
        inputTokens: 400,
        cachedInputTokens: 30_000,
        cachedWriteTokens: 600,
        outputTokens: 400,
        reasoningOutputTokens: 0,
      },
    },
  ],
}
