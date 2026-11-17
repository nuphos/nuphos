// codex-acp reports a turn's usage, in its prompt response and _meta.quota,
// from Codex's `last` token count: the turn's final model request alone. A turn
// that calls the model several times reports only its last call. Report how far
// Codex's running `total` moved since the turn started instead.
const PROMPT_START =
  '    sessionState.currentTurnId = null;\n    sessionState.lastTokenUsage = null;\n'
const UPDATED = '  handleTokenUsageUpdated(params) {\n'
const USAGE = 'this.buildPromptUsage(sessionState.lastTokenUsage)'
const QUOTA = '    const lastTokenUsage = sessionState.lastTokenUsage;\n'
const QUOTA_COUNT = '        token_count: sessionState.lastTokenUsage,\n'
const TO_COUNT = 'function toTokenCount(usage) {'

const delta = `// Each counter of one Codex token count less another's.
function nuphosTokenDelta(to, from) {
  const since = (key) => Math.max(0, (to[key] ?? 0) - (from[key] ?? 0));
  return {
    totalTokens: since("totalTokens"),
    inputTokens: since("inputTokens"),
    cachedInputTokens: since("cachedInputTokens"),
    outputTokens: since("outputTokens"),
    reasoningOutputTokens: since("reasoningOutputTokens")
  };
}
function nuphosTurnTokenUsage(sessionState) {
  const start = sessionState.nuphosTurnStartUsage;
  return sessionState.totalTokenUsage && start ? nuphosTokenDelta(sessionState.totalTokenUsage, start) : sessionState.lastTokenUsage;
}
`

export function patchCodexTurnUsage(source) {
  if (
    source.split(PROMPT_START).length !== 2 ||
    source.split(UPDATED).length !== 2 ||
    source.split(USAGE).length !== 4 ||
    source.split(QUOTA).length !== 2 ||
    source.split(QUOTA_COUNT).length !== 2 ||
    source.split(TO_COUNT).length !== 2
  )
    throw new Error('Expected Codex turn usage handoffs')

  return (
    source
      .replace(
        PROMPT_START,
        `${PROMPT_START}    sessionState.nuphosTurnStartUsage = sessionState.totalTokenUsage;\n`,
      )
      // With no total before the turn (a new or just-loaded session), the first
      // request's own count tells where the total stood when the turn started.
      .replace(
        UPDATED,
        `${UPDATED}    this.sessionState.nuphosTurnStartUsage ??= nuphosTokenDelta(toTokenCount(params.tokenUsage.total), toTokenCount(params.tokenUsage.last));\n`,
      )
      .replaceAll(USAGE, 'this.buildPromptUsage(nuphosTurnTokenUsage(sessionState))')
      .replace(QUOTA, '    const lastTokenUsage = nuphosTurnTokenUsage(sessionState);\n')
      .replace(QUOTA_COUNT, '        token_count: lastTokenUsage,\n')
      .replace(TO_COUNT, `${delta}${TO_COUNT}`)
  )
}
