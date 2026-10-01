import { bool, boundedFloat, boundedInt, optional } from './env'
import { MODEL_PROVIDER, SMALL_MODEL_DEFAULT, modelId } from './model'

// Claude Opus 4.7 on Bedrock supports up to 128K output tokens. This is only
// the configurable envelope; deployments should keep ATLAS_AGENT_MAX_OUTPUT_TOKENS
// at or below the actual model selected by AGENT_MODEL_ID.
const AGENT_OUTPUT_TOKEN_CONFIG_MAX = 128_000

export function agentConfig() {
  return {
    // Which hosted-Claude backend serves every model call. The two providers
    // reach the same Anthropic models but NOT with the same wire options —
    // prompt caching, extended thinking and the token-usage provider label all
    // differ in shape, so the switch is explicit here and consumed through
    // lib/agent/model-provider.ts, never inferred from the model id.
    //   'bedrock' (default) -> AWS Bedrock, `us.anthropic.claude-*` ids
    //   'vertex'            -> GCP Vertex AI Model Garden, bare `claude-*` ids
    modelProvider: MODEL_PROVIDER,
    bedrockRegion: process.env.AWS_BEDROCK_REGION ?? 'us-east-1',
    bedrockAccessKeyId: optional('AWS_BEDROCK_ACCESS_KEY_ID'),
    bedrockSecretAccessKey: optional('AWS_BEDROCK_SECRET_ACCESS_KEY'),
    // Vertex: GCP project + region. Auth is Application Default Credentials
    // (gcloud auth application-default login, or a workload identity on the
    // pod) — there is no key pair to configure. 'global' routes to the
    // multi-region endpoint and is what Model Garden recommends for Claude.
    vertexProject: optional('GOOGLE_VERTEX_PROJECT'),
    vertexLocation: process.env.GOOGLE_VERTEX_LOCATION ?? 'global',
    agentModelId: modelId('AGENT_MODEL_ID', SMALL_MODEL_DEFAULT),
    // Optional model to switch to when a turn-loop round exhausts its retries
    // on a retryable provider error (throttling / 5xx). Unset = keep retrying
    // the primary model only.
    fallbackModelId: modelId('AGENT_FALLBACK_MODEL_ID'),
    // Sticky per-conversation fallback: once any turn is refused by the model's
    // safety filter (finishReason 'content-filter'), every later turn in that
    // conversation runs on this model instead of the primary. Defaults to Opus
    // 4.8 on Vertex (prod). Bedrock has no safe bare default here — a
    // Vertex-form id would fail the provider assertion at boot — so it reuses
    // the primary model unless AGENT_CONTENT_FILTER_FALLBACK_MODEL_ID is set to
    // a Bedrock inference profile.
    contentFilterFallbackModelId:
      MODEL_PROVIDER === 'vertex'
        ? modelId('AGENT_CONTENT_FILTER_FALLBACK_MODEL_ID', 'claude-opus-4-8')
        : modelId(
            'AGENT_CONTENT_FILTER_FALLBACK_MODEL_ID',
            modelId('AGENT_MODEL_ID', SMALL_MODEL_DEFAULT),
          ),
    compactionModelId: modelId('AGENT_COMPACTION_MODEL_ID', SMALL_MODEL_DEFAULT),
    // ADR-0003 memory delivery mode. 'automatic' (default): query the full
    // native pool from the latest user message, attach up to five compact
    // matches at the message tail, then let the model load full detail with
    // memory_get(id). 'injection': the full one-line memory index rides in
    // context every turn. 'summary': only compact counts are injected and the
    // model pulls detail on demand via memory_get(query). Default flipped
    // injection → automatic by product decision: riding the ENTIRE index along
    // every turn misrepresents recall (~44 entries "shown" regardless of
    // relevance) and spends context on noise. ADR-0003's "data owns the
    // default" still holds going forward — the Track A attribution layer
    // records deliveryMode on every turn row, so automatic-vs-injection
    // apply-rate/zero-recall comparisons run against live traffic, and
    // 'injection' stays selectable here for an A/B arm.
    memoryDeliveryMode:
      process.env.MEMORY_DELIVERY_MODE === 'summary'
        ? ('summary' as const)
        : process.env.MEMORY_DELIVERY_MODE === 'injection'
          ? ('injection' as const)
          : ('automatic' as const),
    // ADR-0008 rung 1.5, built-ahead behind a flag (default off): rerank the
    // top-k lexical candidates with a small model before returning search
    // results. Turn on when fetch-through degrades vs the G1 baseline.
    memoryRerankEnabled: process.env.MEMORY_RERANK_ENABLED === 'true',
    // Track A attribution judge: post-hoc LLM verdict (applied/considered/
    // not_applicable) over the memories a turn recalled/fetched. Fail-open,
    // fire-and-forget; rows floor honestly at recalled/fetched when off or
    // failing. Model falls back to the compaction model when unset.
    memoryAttributionJudge: process.env.MEMORY_ATTRIBUTION_JUDGE === 'true',
    memoryAttributionJudgeModel: modelId('MEMORY_ATTRIBUTION_JUDGE_MODEL'),
    // Cost knob for the judge: the fraction of turns it actually runs on when
    // enabled (one LLM call per sampled turn). Sampling is deterministic per
    // turnKey; sampled-out turns record 'skipped_sampled' so coverage stays
    // measurable and distinct from flag-off. 1 = every turn (prior behavior).
    memoryAttributionJudgeSampleRate: boundedFloat('MEMORY_ATTRIBUTION_JUDGE_SAMPLE_RATE', 1, {
      min: 0,
      max: 1,
    }),
    // Track A3 auto-ingest (complete-loop MVP): post-turn distiller saves at
    // most ONE durable memory per turn as an 'auto-learned' record. Zero-yield
    // is the expected common case; volatile observations are never learned.
    // Fail-open, fire-and-forget, origin-gated to user sessions.
    memoryAutoIngest: process.env.MEMORY_AUTO_INGEST === 'true',
    // Before an auto-learned memory is written, check whether it directly
    // contradicts one already in the same pool and supersede that one instead
    // of stacking a second opinion. Off by default: it is the only path that
    // lets ingest tombstone an existing record, so it stays opt-in until the
    // supersede rate has been watched on real traffic.
    memoryConflictSupersede: process.env.MEMORY_CONFLICT_SUPERSEDE === 'true',
    // Track B SPI: memory backend id — must name a registered provider (boot
    // assertion in memory-slots/index.ts fails the deploy on a typo, never a
    // turn). External-residency ids are rejected as the global default (A1:
    // override-only, consent-gated).
    memoryProvider: optional('MEMORY_PROVIDER') ?? 'native',
    // ADR-0008 rung 3 (ranking half only — archive stays unbuilt), built-ahead
    // behind a flag: order the memory indexes by access-decay score instead of
    // raw updatedAt. 'recency' (default) | 'decay'.
    memoryIndexRanking:
      process.env.MEMORY_INDEX_RANKING === 'decay' ? ('decay' as const) : ('recency' as const),
    // Auto Mode: per-command authorization for the bash + local_exec tools
    // (see lib/agent/auto-mode). Always on — read-only commands auto-run,
    // an LLM judge decides the middle against the user's standing policy, and
    // the user can Full Access per-conversation. Judge defaults to the
    // main agent model; set AGENT_AUTO_MODE_JUDGE_MODEL_ID to a stronger model
    // (e.g. Opus 4.8) for sharper effect classification.
    autoMode: {
      // optional() (not ??) so an empty AGENT_AUTO_MODE_JUDGE_MODEL_ID= line —
      // which .env.example ships — falls through to the model default instead
      // of passing '' to the judge.
      judgeModelId:
        modelId('AGENT_AUTO_MODE_JUDGE_MODEL_ID') ??
        modelId('AGENT_MODEL_ID') ??
        SMALL_MODEL_DEFAULT,
      // 15s, not 8s: the judge defaults to the main agent model (Opus via
      // AGENT_MODEL_ID), whose first token on a longer command + policy prompt
      // routinely exceeds 8s — every timeout falls to the require-auth
      // fail-safe and needlessly prompts the user (AbortError).
      judgeTimeoutMs: boundedInt('AGENT_AUTO_MODE_JUDGE_TIMEOUT_MS', 15_000, {
        min: 500,
        max: 30_000,
      }),
      // HMAC secret the AI SDK uses to sign each tool-approval request and
      // verify it on replay — prevents a client forging a self-approval for a
      // command the classifier flagged. Falls back to the journal key; unsigned
      // (undefined) only in a dev env with neither set.
      approvalSecret: optional('AGENT_AUTO_MODE_APPROVAL_SECRET') ?? optional('JOURNAL_HMAC_KEY'),
    },
    // API key for Braintrust tracing. Prompts live in-repo
    // (src/lib/agent/prompts/) — unset only disables tracing.
    braintrustApiKey: optional('BRAINTRUST_API_KEY'),
    braintrustProjectName: optional('BRAINTRUST_PROJECT_NAME') ?? 'atlas-backend',
    braintrustTracingEnabled: bool('BRAINTRUST_TRACING_ENABLED', true),
    maxOutputTokens: boundedInt('ATLAS_AGENT_MAX_OUTPUT_TOKENS', 32_000, {
      min: 1,
      max: AGENT_OUTPUT_TOKEN_CONFIG_MAX,
    }),
    // Extended thinking. The MODE explicitly declares which wire interface to
    // send — deliberately NO model-name guessing: the outage that forced this
    // came from assuming the deployed model matched the code default.
    // NOTE: the deployed model comes from AGENT_MODEL_ID in the cluster
    // Secret — the fallback below is NOT what prod runs. Verify the actual
    // value (and run scripts/thinking-smoke.ts against it) before enabling.
    //   ''         -> disabled (default)
    //   'adaptive' -> thinking.type=adaptive + output_config.effort
    //                 (Opus 4.8+ generation models)
    //   'budget'   -> thinking.type=enabled + budget_tokens
    //                 (Haiku 4.5 / earlier generation models)
    thinkingMode: (() => {
      const raw = (optional('AGENT_THINKING_MODE') ?? '').trim().toLowerCase()

      if (raw !== '' && raw !== 'adaptive' && raw !== 'budget') {
        throw new Error(
          `AGENT_THINKING_MODE must be '', 'adaptive', or 'budget' (got: ${JSON.stringify(raw)})`,
        )
      }

      return raw as '' | 'adaptive' | 'budget'
    })(),
    thinkingEffort: (() => {
      const raw = (optional('AGENT_THINKING_EFFORT') ?? 'medium').trim().toLowerCase()
      const allowed = ['low', 'medium', 'high', 'xhigh', 'max'] as const

      if (!(allowed as readonly string[]).includes(raw)) {
        throw new Error(
          `AGENT_THINKING_EFFORT must be one of ${allowed.join('/')} (got: ${JSON.stringify(raw)})`,
        )
      }

      return raw as (typeof allowed)[number]
    })(),
    // Only used by thinkingMode='budget'. Bedrock rejects budgets under 1024,
    // so misconfiguration fails loudly at startup, not per-request.
    thinkingBudgetTokens: (() => {
      const value = boundedInt('AGENT_THINKING_BUDGET_TOKENS', 0, {
        min: 0,
        max: 16_000,
      })
      const mode = (optional('AGENT_THINKING_MODE') ?? '').trim().toLowerCase()

      if (mode === 'budget' && value < 1024) {
        throw new Error(
          `AGENT_THINKING_MODE=budget requires AGENT_THINKING_BUDGET_TOKENS >= 1024 (got: ${String(value)})`,
        )
      }

      return value
    })(),
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
      // also has a larger shared ceiling. Watch Group partitions do not count
      // individually; the Group itself consumes one slot.
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
