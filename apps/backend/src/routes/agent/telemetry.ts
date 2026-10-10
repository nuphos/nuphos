import { config } from '@/config'
import { ensureConversationTraceParent } from '@/lib/agent/db'
import { createConversationParent, updateConversationParent } from '@/lib/agent/tracing'

import { traceAgentChatError } from './trace'

import type { AgentRunTrace } from './types'
import type { UIMessage } from 'ai'

function truncateTelemetryText(text: string, maxLength = 12000): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function serializeTelemetryPart(part: UIMessage['parts'][number]): Record<string, unknown> {
  if (part.type === 'text') {
    return { type: 'text', text: truncateTelemetryText(part.text) }
  }
  if (part.type === 'file') {
    return {
      type: 'file',
      mediaType: part.mediaType,
      filename: 'filename' in part ? part.filename : undefined,
      hasUrl: Boolean(part.url),
    }
  }

  return { ...(part as Record<string, unknown>) }
}

// Keep the existing role/content trace schema for stored conversation snapshots.
export function serializeTelemetryMessages(messages: UIMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    const parts = message.parts.map(serializeTelemetryPart)
    const content =
      parts.length === 1 && parts[0]?.type === 'text'
        ? (parts[0] as { type: 'text'; text: string }).text
        : parts

    return {
      role: message.role,
      content,
    }
  })
}

export function serializeAssistantOutput(event: any): unknown {
  if (event?.response?.messages) return event.response.messages
  if (typeof event?.text === 'string') return truncateTelemetryText(event.text)

  return undefined
}

type AgentTurnMetrics = {
  elapsed_ms: number
  step_count: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  reasoning_tokens: number
}

export type AgentMemoryRollup = {
  used: boolean
  count: number
  retrieveMs: number
  // Full readable pool sizes (ADR-0008 GAP 1: truncation pressure). count is
  // the entries rendered into context; totals > count means the index cutoff
  // is stranding entries (always the case in summary mode, where count is 0).
  teamTotal?: number
  personalTotal?: number
  unavailable?: boolean
  // Provenance (ADR-0005): ids the index showed the model this turn, and ids
  // the model actually loaded with memory_get during the turn.
  recalledTeamIds?: string[]
  recalledPersonalIds?: string[]
  fetchedIds?: string[]
  // Injection-time label snapshots now live in the turn accumulator's view
  // (memory-slots/turn-accumulator): the judge reads view().recall.entries.
}

export type AgentTurnRollup = {
  finishReason: string | undefined
  metrics: AgentTurnMetrics
  memory: AgentMemoryRollup | null
  output?: unknown
}

export async function ensureConversationRootAfterTurn(args: {
  sessionId: string
  userId: string
  teamId: string | undefined
  locale: string
  firstMessage: string
  messages: UIMessage[]
  requestId: string
  rollup: AgentTurnRollup | null
  trace?: AgentRunTrace
}) {
  const { sessionId, userId, teamId, locale, firstMessage, messages, requestId, rollup, trace } =
    args

  if (!rollup) return

  try {
    const parent = await ensureConversationTraceParent(sessionId, userId, teamId, () =>
      createConversationParent({
        name: 'conversation',
        spanId: sessionId,
        metadata: {
          conversationId: sessionId,
          userId,
          sessionId,
          teamId,
          locale,
          provider: config.agent.modelProvider,
          lastTurnAt: new Date().toISOString(),
          lastFinishReason: rollup.finishReason,
          ...(rollup.memory
            ? {
                lastMemoryUsed: rollup.memory.used,
                lastMemoryCount: rollup.memory.count,
                ...(rollup.memory.fetchedIds
                  ? { lastMemoryFetchedIds: rollup.memory.fetchedIds }
                  : {}),
              }
            : {}),
        },
        metrics: {
          last_turn_elapsed_ms: rollup.metrics.elapsed_ms,
          last_turn_step_count: rollup.metrics.step_count,
          last_turn_input_tokens: rollup.metrics.input_tokens,
          last_turn_output_tokens: rollup.metrics.output_tokens,
          last_turn_total_tokens: rollup.metrics.total_tokens,
          last_turn_reasoning_tokens: rollup.metrics.reasoning_tokens,
          ...(rollup.memory ? { last_memory_retrieve_ms: rollup.memory.retrieveMs } : {}),
        },
        // Chat-shaped input/output so the conversation root is useful even
        // when it is created after the first turn has already streamed.
        input: { messages: serializeTelemetryMessages(messages) },
        ...(rollup.output !== undefined ? { output: rollup.output } : {}),
      }),
    )

    updateConversationParent(parent, {
      metadata: {
        sessionId,
        userId,
        teamId,
        lastTurnAt: new Date().toISOString(),
        lastFinishReason: rollup.finishReason,
        ...(rollup.memory
          ? {
              lastMemoryUsed: rollup.memory.used,
              lastMemoryCount: rollup.memory.count,
              ...(rollup.memory.fetchedIds
                ? { lastMemoryFetchedIds: rollup.memory.fetchedIds }
                : {}),
            }
          : {}),
      },
      metrics: {
        last_turn_elapsed_ms: rollup.metrics.elapsed_ms,
        last_turn_step_count: rollup.metrics.step_count,
        last_turn_input_tokens: rollup.metrics.input_tokens,
        last_turn_output_tokens: rollup.metrics.output_tokens,
        last_turn_total_tokens: rollup.metrics.total_tokens,
        last_turn_reasoning_tokens: rollup.metrics.reasoning_tokens,
        ...(rollup.memory ? { last_memory_retrieve_ms: rollup.memory.retrieveMs } : {}),
      },
    })
  } catch (err) {
    traceAgentChatError('agent.chat.trace_parent_after_turn.error', err, trace, {
      request_id: requestId,
      first_message_present: Boolean(firstMessage),
      rollup_finish_reason: rollup.finishReason,
    })
  }
}

// Flatten every tool call across all steps of a finished turn into a name→count
