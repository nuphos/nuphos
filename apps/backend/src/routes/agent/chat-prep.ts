import { config } from '@/config'
import {
  getCompactionSummary,
  getConversationMemoryProvider,
  recordAgentEvent,
  stampConversationMemoryProvider,
} from '@/lib/agent/db'
import { listConversationRecalledIds } from '@/lib/agent/memory-slots/attribution-store'
import { raceRecallBudget, resolveTurnFromStamp } from '@/lib/agent/memory-slots/runtime'
import { createTurnMemoryAccumulator } from '@/lib/agent/memory-slots/turn-accumulator'
import { listActivePlansForConversation } from '@/lib/agent/plans'
import { renderActivePlanStatusBlock } from '@/lib/agent/stop-gate'
import { logError } from '@/lib/observability'

import { appendAgentRunFrame } from './run-frames'
import { traceAgentChatError } from './trace'

import type { AgentMemoryRollup } from './telemetry'
import type { AgentRun } from './types'
import type { TurnResolution } from '@/lib/agent/memory-slots/runtime'
import type { TurnMemoryAccumulator } from '@/lib/agent/memory-slots/turn-accumulator'

export type TurnMemoryResult = {
  resolution: TurnResolution
  accumulator: TurnMemoryAccumulator | null
}

export type MemoryRecallResult = {
  memoryBlock: string | null
  lastMemoryRollup: AgentMemoryRollup | null
  /** One-line labels for what recall surfaced, keyed by memory id. Carried so
   * the turn-start frame can name what was remembered instead of only counting
   * it — the desktop would otherwise fetch each memory back one call at a
   * time, which is a lot of round trips for text the runtime already holds. */
  recalledLabels?: Record<string, string>
  // 'user-message-tail' appends the block to the last user message (the
  // provider-reported placement that replaces the old deliveryMode ===
  // 'automatic' branch); 'system-block' injects a system message.
  memoryPlacement: 'system-block' | 'user-message-tail'
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
 * Turn-START provenance frame: what the agent remembered, named and on screen
 * before the answer begins.
 *
 * This is the same frame shape the finalizer emits, deliberately — both carry
 * the session-scoped part id, so the finalizer's version (which can also report
 * what the agent looked up mid-turn, and later what the judge confirmed)
 * replaces this one in place. Emitting early only changes WHEN the evidence
 * appears, never what it is: recall is the one part of the turn that is already
 * settled before the model runs, so there is nothing to wait for.
 *
 * Labels ride along because the runtime already has them; without that the
 * desktop fetches each remembered memory back individually just to show a
 * title, which is both slow and a strange thing to do for text we just read.
 */
export function emitRecallStartFrame(
  run: AgentRun | undefined,
  sessionId: string,
  requestId: string,
  recall: MemoryRecallResult,
): void {
  const rollup = recall.lastMemoryRollup

  if (!run || recall.memoryPlacement !== 'user-message-tail' || (rollup?.count ?? 0) === 0) return
  appendAgentRunFrame(
    run,
    `data: ${JSON.stringify({
      type: 'memory-provenance',
      sessionId,
      turnKey: requestId,
      // The ribbon words itself differently per mode; omitting this made a
      // query-selected recall read as a whole-index ride ("shown", not
      // "recalled").
      deliveryMode: config.agent.memoryDeliveryMode,
      recalledTeamIds: rollup?.recalledTeamIds ?? [],
      recalledPersonalIds: rollup?.recalledPersonalIds ?? [],
      // Nothing has been looked up or judged yet — the finalizer fills those in
      // when it replaces this frame.
      fetchedIds: [],
      fetchedPersonalIds: [],
      fetchedTeamIds: [],
      labels: recall.recalledLabels ?? {},
    })}\n\n`,
  )
}

/**
 * Per-turn memory resolution (memory-slots SPI): ONE projected findOne on
 * the conversation's immutable memoryProvider stamp, shared by recall, tool
 * creation, and the finalizer. Unstamped legacy conversations resolve to the
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

/**
 * Native memory context (§ Agent Memory): injection/summary render stable
 * pool indexes or counts; automatic uses the latest user message to search
 * the full native pool and returns up to five compact pointers.
 */
export function buildMemoryPromise(args: {
  memoryRecallPlanned: boolean
  // Search-only query (composeRecallQuery): a thin follow-up is enriched with
  // prior context. Deliberately NOT the raw memoryQuery the judge/digest use.
  recallQuery: string
  sessionId: string
  userId: string
  teamId: string | undefined
  turnMemoryPromise: Promise<TurnMemoryResult>
}): Promise<MemoryRecallResult> {
  const {
    memoryRecallPlanned,
    recallQuery,
    sessionId: id,
    userId,
    teamId,
    turnMemoryPromise,
  } = args
  const empty: MemoryRecallResult = {
    memoryBlock: null,
    lastMemoryRollup: null,
    memoryPlacement: 'system-block',
  }

  return !memoryRecallPlanned
    ? Promise.resolve(empty)
    : (async () => {
        try {
          const { resolution, accumulator } = await turnMemoryPromise

          if (resolution.kind !== 'active' || !accumulator) return empty
          const memoryRetrieveStartedAt = Date.now()
          // raceRecallBudget never throws: timeout/throw/absent slot resolve
          // null — recall failure is "no context", never a turn error.
          const rendered = await raceRecallBudget(resolution.provider, {
            userId,
            teamId: teamId ?? null,
            query: recallQuery,
            conversationId: id,
            excludeIds: await listConversationRecalledIds(id),
          })
          const memoryRetrieveMs = Date.now() - memoryRetrieveStartedAt

          // The accumulator can derive matched/no_match/failed itself; only
          // the empty-query case needs the caller, who alone holds the query.
          accumulator.noteRecall(
            rendered,
            memoryRetrieveMs,
            rendered && recallQuery.trim() === '' ? 'empty_query' : undefined,
          )
          if (!rendered) {
            // Null/aborted recall keeps the legacy null-rollup semantics.
            return empty
          }
          const recallView = accumulator.view().recall!
          const diagnostics = rendered.diagnostics ?? {}

          recordAgentEvent({
            conversationId: id,
            event: 'memory.retrieved',
            userId,
            data: {
              // Legacy field names locked (only `provider` is additive): the
              // native boolean survives as a derived flag, and the adapter's
              // diagnostics spread verbatim carries the legacy count keys.
              // Spread FIRST: diagnostics are provider-controlled, and a key
              // colliding with a runtime-owned field must never corrupt
              // provider attribution.
              ...diagnostics,
              native: resolution.providerId === 'native',
              provider: resolution.providerId,
              deliveryMode: config.agent.memoryDeliveryMode,
              count: recallView.count,
              used: rendered.block !== null,
              durationMs: memoryRetrieveMs,
              recalledTeamIds: recallView.teamIds,
              recalledPersonalIds: recallView.personalIds,
            },
          })

          return {
            memoryBlock: rendered.block,
            lastMemoryRollup: {
              used: rendered.block !== null,
              count: recallView.count,
              retrieveMs: memoryRetrieveMs,
              teamTotal:
                typeof diagnostics.teamTotal === 'number' ? diagnostics.teamTotal : undefined,
              personalTotal:
                typeof diagnostics.personalTotal === 'number'
                  ? diagnostics.personalTotal
                  : undefined,
              ...(recallView.teamIds.length ? { recalledTeamIds: recallView.teamIds } : {}),
              ...(recallView.personalIds.length
                ? { recalledPersonalIds: recallView.personalIds }
                : {}),
            },
            recalledLabels: Object.fromEntries(
              recallView.entries.map((e) => [e.id, e.label.slice(0, 140)]),
            ),
            memoryPlacement: rendered.placement ?? ('system-block' as const),
          }
        } catch (err) {
          // Fail open: a memory failure must never block the turn.
          logError('agent.memory.index_error', err, { teamId })

          return empty
        }
      })()
}
