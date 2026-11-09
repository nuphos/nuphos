import { randomUUID } from 'node:crypto'

import { storedPick } from '@/lib/claude-code-preview/session-config-options'
import { logError } from '@/lib/observability'

import { getConversationPreviewAttachment } from './db'
import { agentTokenUsage, cleanRecord } from './token-usage-db'
import { normalizeTokenUsage } from './token-usage-normalize'
import { refreshConversationTokenUsageSummary } from './token-usage-summary'

import type { ConversationTriggerRun } from './conversation-trigger-run'
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
  /** The raw usage object the runtime reported for the turn. */
  usage: unknown
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
  const tokens = normalizeTokenUsage(turn.usage)

  // Runtimes that report nothing record nothing; nothing is estimated.
  if (Object.keys(tokens).length === 0) return
  const modelId = await turnModelId(turn.sessionId, turn.teamId)

  await agentTokenUsage().insertMany(turnUsageRows(turn, tokens, modelId))
  await refreshConversationTokenUsageSummary(turn.sessionId, turn.userId, turn.teamId)
}

async function turnModelId(sessionId: string, teamId: string): Promise<string> {
  const attachment = await getConversationPreviewAttachment(sessionId, teamId).catch(() => null)

  return storedPick(attachment ?? undefined).model ?? 'unknown'
}

// The same shape the AI SDK path writes: one model call records a step_total
// row plus one row per token class, and every consumer sums a class only from
// the kind that owns it (see KIND_FOR_TOKEN_FIELD).
function turnUsageRows(
  turn: RuntimeTurnUsage,
  tokens: AgentTokenUsageTokens,
  modelId: string,
): AgentTokenUsageRecord[] {
  const createdAt = new Date()
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
