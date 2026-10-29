import {
  getCompactionSummary,
  getConversationMemoryProvider,
  recordAgentEvent,
  stampConversationMemoryProvider,
} from '@/lib/agent/db'
import { resolveTurnFromStamp } from '@/lib/agent/memory-slots/runtime'
import { createTurnMemoryAccumulator } from '@/lib/agent/memory-slots/turn-accumulator'
import { listActivePlansForConversation } from '@/lib/agent/plans'
import { renderActivePlanStatusBlock } from '@/lib/agent/stop-gate'
import { logError } from '@/lib/observability'

import { appendAgentRunFrame } from './run-frames'
import { traceAgentChatError } from './trace'

import type { AgentRun } from './types'
import type { TurnResolution } from '@/lib/agent/memory-slots/runtime'
import type { TurnMemoryAccumulator } from '@/lib/agent/memory-slots/turn-accumulator'

export type TurnMemoryResult = {
  resolution: TurnResolution
  accumulator: TurnMemoryAccumulator | null
}

export function buildCompactionPromise(
  sessionId: string,
  conversationOwnerUserId: string,
  incomingMessageCount: number,
  run: AgentRun | undefined,
) {
  return (async () => {
    try {
      return await getCompactionSummary(sessionId, conversationOwnerUserId)
    } catch (err) {
      traceAgentChatError('agent.chat.compaction_load.error', err, run?.trace, {
        incoming_message_count: incomingMessageCount,
      })

      return null
    }
  })()
}

/**
 * Live plan-state block, re-fetched from Mongo every turn: the model gets
 * the stored lifecycle truth for every non-terminal plan in this
 * conversation. Fail-open — a Mongo hiccup must not block the turn.
 */
export function buildActivePlanStatusPromise(
  sessionId: string,
  teamId: string | undefined,
  userId: string,
  run: AgentRun | undefined,
): Promise<string | null> {
  return (async () => {
    try {
      const activePlans = await listActivePlansForConversation(sessionId, { teamId, userId })

      return renderActivePlanStatusBlock(activePlans)
    } catch (err) {
      traceAgentChatError('agent.chat.plan_state.load_failed', err, run?.trace, {
        session_id: sessionId,
      })

      return null
    }
  })()
}

/**
 * Per-turn memory resolution (memory-slots SPI): ONE projected findOne on
 * the conversation's immutable memoryProvider stamp, shared by tool creation
 * and the finalizer. Unstamped legacy conversations resolve to the
 * global default and get lazily write-once stamped (filter-guarded — a doc
 * that already carries any stamp never matches). The accumulator is created
 * here too: one per chat request, owning what the finalizer used to spread
 * across three ad-hoc Maps.
 */
export function buildTurnMemoryPromise(args: {
  sessionId: string
  userId: string
  teamId: string | undefined
  requestId: string
  run: AgentRun | undefined
}): Promise<TurnMemoryResult> {
  const { sessionId: id, userId, teamId, requestId, run } = args

  return (async () => {
    // Stamp read + resolution live in resolveTurnFromStamp (unit-tested): a
    // failed read degrades this turn memory-off (fail closed) and never
    // lazy-stamps; a successful read with no stamp resolves the global default
    // and lazily write-once stamps pre-stamp conversations (filter-guarded).
    const resolution = await resolveTurnFromStamp({
      readStamp: () => getConversationMemoryProvider(id),
      lazyStamp: (providerId) => {
        void stampConversationMemoryProvider(id, providerId).catch((err: unknown) => {
          logError('agent.memory.stamp_write_error', err, { teamId })
        })
      },
      team: { teamId: teamId ?? null },
    })
    const accumulator =
      resolution.kind === 'active'
        ? createTurnMemoryAccumulator({
            providerId: resolution.providerId,
            sessionId: id,
            userId,
            teamId: teamId ?? null,
            requestId,
            emitFrame: (frame) => {
              if (run) appendAgentRunFrame(run, `data: ${JSON.stringify(frame)}\n\n`)
            },
            recordEvent: recordAgentEvent,
          })
        : null

    return { resolution, accumulator }
  })()
}
