// Model-id shape rules for the two providers, as pure functions so they are
// testable without booting config (which freezes a singleton at import and
// would need env gymnastics per case).
//
// Bedrock addresses a model by inference profile (`us.anthropic.claude-…`,
// `global.anthropic.claude-…`); Vertex wants the bare published id
// (`claude-opus-5`). Crossing them fails at RUNTIME — a Bedrock id sent to
// Vertex is a 400 on the first compaction or judge call, long after boot — so
// config.ts runs these at startup and turns it into a boot error instead.

export type ModelProvider = 'bedrock' | 'vertex'

/** Bedrock inference profiles carry a `<scope>.anthropic.` prefix; Vertex ids never do. */
export function looksLikeBedrockModelId(raw: string): boolean {
  return /\banthropic\./.test(raw)
}

/** Throws when `raw` is addressed to the other provider. */
export function assertModelIdMatchesProvider(
  provider: ModelProvider,
  key: string,
  raw: string,
): void {
  const looksBedrock = looksLikeBedrockModelId(raw)

  if (provider === 'vertex' && looksBedrock) {
    throw new Error(
      `${key}=${JSON.stringify(raw)} is a Bedrock inference profile, but AGENT_MODEL_PROVIDER=vertex. ` +
        `Vertex takes the bare published id (e.g. 'claude-opus-5').`,
    )
  }
  if (provider === 'bedrock' && !looksBedrock) {
    throw new Error(
      `${key}=${JSON.stringify(raw)} is not a Bedrock inference profile, but AGENT_MODEL_PROVIDER=bedrock. ` +
        `Bedrock takes a region- or global-prefixed id (e.g. 'global.anthropic.claude-opus-5').`,
    )
  }
}

/**
 * The default the secondary models (compaction, judges, rerank, cost insight)
 * fall back to.
 *
 * Bedrock entitles the whole Anthropic catalogue at once, so a cheap hardcoded
 * default is safe there. Vertex entitles PER MODEL through a Marketplace step,
 * so any hardcoded second model is a 404 waiting to happen — verified on
 * project nuphos, where claude-opus-5 was enabled and both claude-haiku-4-5 and
 * claude-sonnet-5 returned 404 through the same SDK path. On Vertex the
 * secondaries therefore reuse the main model, which is entitled by definition,
 * and the main model becomes required.
 */
export function resolveSmallModelDefault(
  provider: ModelProvider,
  agentModelId: string | undefined,
  bedrockDefault: string,
): string {
  if (provider !== 'vertex') return bedrockDefault
  if (!agentModelId) {
    throw new Error(
      'AGENT_MODEL_ID is required when AGENT_MODEL_PROVIDER=vertex — there is no safe default, ' +
        "because Vertex grants access one model at a time (e.g. 'claude-opus-5').",
    )
  }

  return agentModelId
}

/** Parses AGENT_MODEL_PROVIDER, rejecting anything outside the allowlist. */
export function parseModelProvider(raw: string | undefined): ModelProvider {
  const normalized = (raw ?? 'bedrock').trim().toLowerCase()

  if (normalized !== 'bedrock' && normalized !== 'vertex') {
    throw new Error(
      `AGENT_MODEL_PROVIDER must be 'bedrock' or 'vertex' (got: ${JSON.stringify(normalized)})`,
    )
  }

  return normalized
}
