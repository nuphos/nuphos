// Memory for Claude Code preview turns: the classic recall before the turn
// (attached to the prompt text, the only carrier ACP offers) and the classic
// capture → judge → ingest chain after it, driven by the same provider slot.
import { config } from '@/config'
import { captureTurnAttribution } from '@/lib/agent/memory-slots/attribution-capture'
import { runAttributionJudge } from '@/lib/agent/memory-slots/attribution-judge'
import { recordTurnDistillOutcome } from '@/lib/agent/memory-slots/attribution-store'
import { dispatchTurnIngest } from '@/lib/agent/memory-slots/ingest-dispatch'
import { buildTurnDigestMessages } from '@/lib/agent/memory-slots/turn-digest'
import { logError } from '@/lib/observability'
import { buildMemoryPromise, buildTurnMemoryPromise } from '@/routes/agent/chat-prep'
import { composeRecallQuery } from '@/routes/agent/recall-query'
import { getUserMessageTexts } from '@/routes/agent/transcript'
import { isPlanApprovalTurn } from '@/routes/agent/turn-kind'

import type { RecalledEntry } from '@/lib/agent/memory-slots/types'
import type { MemoryRecallResult, TurnMemoryResult } from '@/routes/agent/chat-prep'
import type { UIMessage } from 'ai'

export type PreviewTurnMemory = {
  turnMemory: TurnMemoryResult
  recall: MemoryRecallResult
  /** The raw latest user text — what the judge and the digest must see. */
  memoryQuery: string
  /** The turn is a plan approval a surface generated: not a memory source. */
  planApproval: boolean
}

export async function recallForPreviewTurn(args: {
  sessionId: string
  userId: string
  teamId: string
  requestId: string
  messages: UIMessage[]
}): Promise<PreviewTurnMemory> {
  const userTexts = getUserMessageTexts(args.messages)
  const planApproval = isPlanApprovalTurn(args.messages.findLast((m) => m.role === 'user'))
  // An approval names no topic; the request it approved is the query.
  const recallTexts = getUserMessageTexts(args.messages.filter((m) => !isPlanApprovalTurn(m)))
  const turnMemoryPromise = buildTurnMemoryPromise({
    sessionId: args.sessionId,
    userId: args.userId,
    teamId: args.teamId,
    requestId: args.requestId,
    run: undefined,
  })
  const recall = await buildMemoryPromise({
    memoryRecallPlanned: recallTexts.length > 0,
    recallQuery: composeRecallQuery(recallTexts),
    sessionId: args.sessionId,
    userId: args.userId,
    teamId: args.teamId,
    turnMemoryPromise,
  })

  return {
    turnMemory: await turnMemoryPromise,
    recall,
    memoryQuery: userTexts[0] ?? '',
    planApproval,
  }
}

/**
 * Same placement as the classic turn's `user-message-tail`: the recall block
 * rides after the user's own text as a separate paragraph. ACP prompts are
 * plain text, so this is the whole of "inline".
 */
export function prefixUserMessage(message: string, recallBlock: string | null): string {
  return recallBlock ? `${message}\n\n${recallBlock}` : message
}

export type PreviewToolStep = {
  toolCallId: string
  toolName: string
  input: unknown
  output?: unknown
}

/** The finish-event shape the turn digest reads tool calls and results from. */
function digestEvent(text: string, toolSteps: PreviewToolStep[]) {
  return {
    text,
    steps: [
      {
        toolCalls: toolSteps.map((step) => ({
          toolCallId: step.toolCallId,
          toolName: step.toolName,
          input: step.input,
        })),
        toolResults: toolSteps
          .filter((step) => step.output !== undefined)
          .map((step) => ({ toolCallId: step.toolCallId, output: step.output })),
      },
    ],
  }
}

/** Post-turn memory chain (attribution → judge → ingest); fail-open. */
export async function ingestPreviewTurn(args: {
  sessionId: string
  userId: string
  teamId: string
  requestId: string
  memory: PreviewTurnMemory
  answer: string
  toolSteps: PreviewToolStep[]
  startedAt: number
  emitFrame?: (frame: Record<string, unknown>) => void
}): Promise<void> {
  const { turnMemory, recall, memoryQuery } = args.memory
  const { resolution, accumulator } = turnMemory
  const view = accumulator?.view() ?? null
  const provider = resolution.kind === 'active' ? resolution.providerId : undefined
  const rollup = recall.lastMemoryRollup

  if (args.emitFrame && view && (view.recall || view.fetchedIds.length > 0)) {
    args.emitFrame({
      type: 'memory-provenance',
      sessionId: args.sessionId,
      turnKey: args.requestId,
      deliveryMode: config.agent.memoryDeliveryMode,
      recalledTeamIds: rollup?.recalledTeamIds ?? [],
      recalledPersonalIds: rollup?.recalledPersonalIds ?? [],
      fetchedIds: view.fetchedIds,
      fetchedTeamIds: view.fetchedTeamIds,
      fetchedPersonalIds: view.fetchedPersonalIds,
      labels: {
        ...(recall.recalledLabels ?? {}),
        ...Object.fromEntries(view.fetchedLabels),
      },
    })
  }

  try {
    await captureTurnAttribution({
      provider,
      teamId: args.teamId,
      userId: args.userId,
      conversationId: args.sessionId,
      turnKey: args.requestId,
      deliveryMode: config.agent.memoryDeliveryMode,
      recallOutcome: view?.recallOutcome ?? 'not_planned',
      recalledTeamIds: rollup?.recalledTeamIds ?? [],
      recalledPersonalIds: rollup?.recalledPersonalIds ?? [],
      fetchedTeamIds: view?.fetchedTeamIds ?? [],
      fetchedPersonalIds: view?.fetchedPersonalIds ?? [],
      supersededTeamIds: view?.supersededTeamIds ?? [],
      supersededPersonalIds: view?.supersededPersonalIds ?? [],
    })
    await runAttributionJudge({
      provider,
      teamId: args.teamId,
      userId: args.userId,
      conversationId: args.sessionId,
      turnKey: args.requestId,
      query: memoryQuery,
      answer: args.answer,
      recalled: (view?.recall?.entries ?? []).map((entry: RecalledEntry) => ({
        memoryId: entry.id,
        scope: entry.scope,
        kind: entry.kind === 'playbook' ? ('gene' as const) : ('record' as const),
        label: entry.label,
      })),
      fetchedLabels: view?.fetchedLabels ?? new Map<string, string>(),
    })
    if (args.memory.planApproval) {
      await recordTurnDistillOutcome(args.sessionId, args.requestId, 'skipped_plan_approval')

      return
    }
    await dispatchTurnIngest(
      resolution,
      {
        conversationId: args.sessionId,
        userId: args.userId,
        teamId: args.teamId,
        origin: 'user',
        messages: buildTurnDigestMessages(digestEvent(args.answer, args.toolSteps), {
          query: memoryQuery,
          answer: args.answer,
        }),
        planId: null,
        startedAt: new Date(args.startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
      },
      {
        turnKey: args.requestId,
        ...(args.emitFrame ? { emitFrame: args.emitFrame } : {}),
        ...(view ? { view } : {}),
      },
    )
  } catch (err) {
    logError('agent.memory.attribution_error', err, { teamId: args.teamId })
  }
}
