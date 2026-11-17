import { bool, boundedInt, optional } from './env'

// The configurable output-token envelope; deployments should keep
// ATLAS_AGENT_MAX_OUTPUT_TOKENS at or below what the runtime's model supports.
const AGENT_OUTPUT_TOKEN_CONFIG_MAX = 128_000

export function agentConfig() {
  return {
    // Track B SPI: memory backend id — must name a registered provider (boot
    // assertion in memory-slots/index.ts fails the deploy on a typo, never a
    // turn). External-residency ids are rejected as the global default (A1:
    // override-only, consent-gated).
    memoryProvider: optional('MEMORY_PROVIDER') ?? 'native',
    // 0 preserves all history. Positive values expire both headers and chunks.
    mongoTraceRetentionDays: boundedInt('AGENT_MONGO_TRACE_RETENTION_DAYS', 0, {
      min: 0,
      max: 36500,
    }),
    maxOutputTokens: boundedInt('ATLAS_AGENT_MAX_OUTPUT_TOKENS', 32_000, {
      min: 1,
      max: AGENT_OUTPUT_TOKEN_CONFIG_MAX,
    }),
    modelOutputBudgetTokens: boundedInt('ATLAS_AGENT_MODEL_OUTPUT_BUDGET_TOKENS', 30_000, {
      min: 1,
      max: AGENT_OUTPUT_TOKEN_CONFIG_MAX,
    }),
    backendUrl: optional('NUPHOS_BACKEND_URL') ?? optional('ATLAS_BACKEND_URL'),
    // Reachable from outside the cluster. Self-hosted runtimes fetch skills
    // and call Nuphos tools here; managed pods keep using the Service.
    publicBackendUrl: optional('NUPHOS_PUBLIC_BACKEND_URL'),
    triggers: {
      // A team member keeps the historical personal ceiling while the team
      // also has a larger shared ceiling.
      maxPerOwner: 50,
      maxPerTeam: 500,
      // Default cooldown between webhook-triggered runs of the SAME trigger.
      // Every accepted delivery starts a full agent session, so a flapping
      // alert or a sender retry storm must not translate 1:1 into sessions.
      // Per-trigger override: AgentTrigger.minIntervalSeconds. 0 disables.
      webhookCooldownSeconds: 60,
    },
    // Conversations idle this many days are archived by an hourly sweep; 0 = off.
    autoArchiveIdleDays: boundedInt('AGENT_AUTO_ARCHIVE_IDLE_DAYS', 7, { min: 0, max: 365 }),
    ragApiKey: optional('RAG_API_KEY'),
    tavilyApiKey: optional('TAVILY_API_KEY'),
    firecrawlApiKey: optional('FIRECRAWL_API_KEY'),
  }
}
