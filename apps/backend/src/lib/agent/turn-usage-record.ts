import { randomUUID } from 'node:crypto'

import { storedPick } from '@/lib/claude-code-preview/session-config-options'
import { logError } from '@/lib/observability'

import { getConversationPreviewAttachment } from './db'
import { agentTokenUsage, cleanRecord } from './token-usage-db'
import { refreshConversationTokenUsageSummary } from './token-usage-summary'

import type { ConversationTriggerRun } from './conversation-trigger-run'
import type { SessionConfigOption } from '@/lib/claude-code-preview/session-config-options'
import type {
  AgentTokenUsageKind,
  AgentTokenUsageRecord,
  AgentTokenUsageTokens,
} from './token-usage-db'

export type RuntimeTurnUsage = {
  sessionId: string
  userId: string
  teamId: string
  provider: string
  /** The ACP `PromptResponse.usage` the runtime reported for the turn. */
  usage: unknown
  /** The agent's `_meta.quota`, whose `model_usage` splits the turn by model. */
  quota?: unknown
  /** How the turn ended (ACP `stopReason`): `end_turn`, `cancelled`, … */
  stopReason?: string
  actorUserId?: string
  turnSource?: string
  runtimeId?: string
  deviceId?: string
  /** The fire that produced this turn, when it was a Trigger that did. */
  trigger?: ConversationTriggerRun
}

/**
 * Record the usage one agent-runtime turn reported.
 *
 * Deliberately fire-and-forget: the turn has already finished, so accounting
 * must never fail it or hold its response. A storage failure is logged and
 * swallowed; every promise here has its rejection handled.
 */
export function recordRuntimeTurnUsage(turn: RuntimeTurnUsage): void {
  void writeRuntimeTurnUsage(turn).catch((error: unknown) => {
    logError('agent.turn_usage.record_failed', error, {
      session_id: turn.sessionId,
      team_id: turn.teamId,
      ...(turn.trigger ? { trigger_id: turn.trigger.id } : {}),
    })
  })
}

/** The write itself, so a test can await what the turn path must not. */
export async function writeRuntimeTurnUsage(turn: RuntimeTurnUsage): Promise<void> {
  const byModel = quotaModelTokens(turn.quota)
  // Every row of the turn, whatever its model, carries one time: it is how a turn is counted.
  const createdAt = new Date()
  const rows = (
    byModel.length
      ? byModel
      : [
          {
            modelId: await turnModelId(turn.sessionId, turn.teamId),
            tokens: acpUsageTokens(turn.usage),
          },
        ]
  ).flatMap(({ modelId, tokens }) =>
    Object.keys(tokens).length ? turnUsageRows(turn, tokens, modelId, createdAt) : [],
  )

  // Runtimes that report nothing record nothing; nothing is estimated.
  if (rows.length === 0) return
  await agentTokenUsage().insertMany(rows)
  await refreshConversationTokenUsageSummary(turn.sessionId, turn.userId, turn.teamId)
}

async function turnModelId(sessionId: string, teamId: string): Promise<string> {
  const attachment = await getConversationPreviewAttachment(sessionId, teamId).catch(() => null)

  return pickedModelId(attachment ?? undefined)
}

/**
 * The model a session's picker is on, as a model id. Claude Code offers aliases
 * (`default`, `opus`, `sonnet`, …) that move with each release, so an alias is
 * read through the label the runtime gave it, "Opus 5.5" → `claude-opus-5-5`;
 * `default` names its model in the description. A Claude alias no label names
 * is `unknown`; any other value, such as `opencode/big-pickle`, is kept.
 */
export function pickedModelId(attachment?: Parameters<typeof storedPick>[0]): string {
  const value = storedPick(attachment).model

  return value ? resolveModelAlias(value, attachment?.sessionConfig) : 'unknown'
}

const CLAUDE_FAMILIES = 'opus|sonnet|haiku|fable|mythos'

/** `value` as a model id, read through `sessionConfig`'s labels when it is an alias. */
export function resolveModelAlias(value: string, sessionConfig?: SessionConfigOption[]): string {
  // A model id carries a version; an alias does not.
  if (/\d/.test(value)) return value
  const choice = sessionConfig
    ?.find((option) => option.kind === 'model')
    ?.options.find((option) => option.value === value)
  const [, family, version] =
    new RegExp(`^(${CLAUDE_FAMILIES}) (\\d+(?:\\.\\d+)*)$`, 'i').exec(
      (value === 'default' ? choice?.description : choice?.name)?.trim() ?? '',
    ) ?? []

  if (family && version) return `claude-${family.toLowerCase()}-${version.replaceAll('.', '-')}`

  // A Claude alias the picker does not name is unknown, never shown as the alias.
  return new RegExp(`^(default|${CLAUDE_FAMILIES})$`, 'i').test(value) ? 'unknown' : value
}

// claude-agent-acp and codex-acp send the uncached remainder as ACP `inputTokens`;
// gemini-cli sends the whole prompt. Ours is the whole prompt, so the cache classes
// are added back in unless the reported total shows they are already inside it.
function acpUsageTokens(usage: unknown): AgentTokenUsageTokens {
  if (!usage || typeof usage !== 'object') return {}
  const acp = usage as Record<string, unknown>
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined
  const uncached = count(acp.inputTokens)
  const cachedInputTokens = count(acp.cachedReadTokens)
  const cacheWriteTokens = count(acp.cachedWriteTokens)
  const outputTokens = count(acp.outputTokens)
  const totalTokens = count(acp.totalTokens)
  const prompt = [uncached, cachedInputTokens, cacheWriteTokens].filter((n) => n !== undefined)
  const split = prompt.length ? prompt.reduce((sum, n) => sum + n, 0) : undefined
  const whole =
    totalTokens !== undefined && split !== undefined && totalTokens < split + (outputTokens ?? 0)

  return cleanRecord({
    inputTokens: whole ? uncached : split,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens: count(acp.thoughtTokens),
    totalTokens,
  })
}

// `_meta.quota.model_usage`: one token count per model the turn used. Claude's
// also counts Task sub-agents, sidechains and compaction, which its `usage`
// leaves out, so it is the fuller record when present.
function quotaModelTokens(quota: unknown): { modelId: string; tokens: AgentTokenUsageTokens }[] {
  const models = (quota as { model_usage?: unknown } | null | undefined)?.model_usage

  if (!Array.isArray(models)) return []

  return models.flatMap(
    (entry: { model?: unknown; token_count?: Record<string, unknown> } | null) => {
      const count = entry?.token_count

      if (typeof entry?.model !== 'string' || !entry.model || !count) return []

      const tokens = acpUsageTokens({
        inputTokens: count.inputTokens,
        cachedReadTokens: count.cachedInputTokens,
        cachedWriteTokens: count.cachedWriteTokens,
        outputTokens: count.outputTokens,
        // Claude always sends 0 here: its thinking is billed inside the output.
        thoughtTokens: count.reasoningOutputTokens === 0 ? undefined : count.reasoningOutputTokens,
        totalTokens: count.totalTokens,
      })

      // A model with nothing countable is left out, so a quota with none falls back to `usage`.
      return Object.keys(tokens).length ? [{ modelId: entry.model, tokens }] : []
    },
  )
}

// The same shape the AI SDK path writes: one model call records a step_total
// row plus one row per token class, and every consumer sums a class only from
// the kind that owns it (see KIND_FOR_TOKEN_FIELD).
function turnUsageRows(
  turn: RuntimeTurnUsage,
  tokens: AgentTokenUsageTokens,
  modelId: string,
  createdAt: Date,
): AgentTokenUsageRecord[] {
  const trigger = triggerFields(turn.trigger)
  const row = (kind: AgentTokenUsageKind, part: AgentTokenUsageTokens): AgentTokenUsageRecord => ({
    recordId: randomUUID(),
    sessionId: turn.sessionId,
    userId: turn.userId,
    teamId: turn.teamId,
    operation: 'agent.turn',
    source: 'agent-runtime',
    kind,
    accounting: 'upstream_reported',
    provider: turn.provider,
    modelId,
    tokens: part,
    createdAt,
    ...trigger,
    ...cleanRecord({
      finishReason: turn.stopReason,
      actorUserId: turn.actorUserId,
      turnSource: turn.turnSource,
      runtimeId: turn.runtimeId,
      deviceId: turn.deviceId,
    }),
  })
  const prompt = pickTokens(tokens, ['inputTokens', 'cachedInputTokens', 'cacheWriteTokens'])
  const output = pickTokens(tokens, ['outputTokens'])
  const thinking = pickTokens(tokens, ['reasoningTokens'])

  return [
    row('step_total', cleanRecord({ ...tokens, totalTokens: turnTotalTokens(tokens) })),
    ...(Object.keys(prompt).length ? [row('input', prompt)] : []),
    ...(Object.keys(output).length ? [row('output', output)] : []),
    ...(Object.keys(thinking).length ? [row('thinking', thinking)] : []),
  ]
}

// Agents report a total inconsistently; derive it from what they did report
// so a per-conversation total always exists.
function turnTotalTokens(tokens: AgentTokenUsageTokens): number | undefined {
  if (tokens.totalTokens != null) return tokens.totalTokens
  if (tokens.inputTokens == null && tokens.outputTokens == null) return undefined

  return (tokens.inputTokens ?? 0) + (tokens.outputTokens ?? 0)
}

function pickTokens(
  tokens: AgentTokenUsageTokens,
  fields: (keyof AgentTokenUsageTokens)[],
): AgentTokenUsageTokens {
  return cleanRecord(Object.fromEntries(fields.map((field) => [field, tokens[field]])))
}

function triggerFields(trigger?: ConversationTriggerRun): Partial<AgentTokenUsageRecord> {
  if (!trigger) return {}

  return {
    triggerId: trigger.id,
    ...(trigger.kind ? { triggerKind: trigger.kind } : {}),
    ...(trigger.fireId ? { triggerFireId: trigger.fireId } : {}),
  }
}
