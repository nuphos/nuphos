// The tail of a Claude Code preview turn, mirroring the classic onFinish:
// persist the assistant message (and any steered exchange segments) with
// their tool steps, give the conversation a title, and hand the turn to the
// memory ingest chain.
import { randomUUID } from 'node:crypto'

import { serializeMessageDoc } from './errors'
import { traceAgentChatError } from './trace'
import { getFirstTranscriptMessage, uiMessagesToTranscript } from './transcript'

import type { AgentRun } from './types'
import type { PreviewTurnMemory } from '@/lib/claude-code-preview/preview-recall'
import type { PreviewToolStep } from '@/lib/claude-code-preview/preview-transcript'
import type { TurnDiagnostics } from '@/lib/claude-code-preview/turn-diagnostics'
import type { UIMessage } from 'ai'

import { getConversationMessagesHead, syncConversationTranscript } from '@/lib/agent/db'
import { mergePreviewMemoryActivity } from '@/lib/agent/memory-slots/preview-activity-store'
import { listPlansCreatedForConversation } from '@/lib/agent/plans'
import { partsWithoutFailureNotice } from '@/lib/claude-code-preview/codex-turn-failure'
import { ingestPreviewTurn } from '@/lib/claude-code-preview/preview-recall'
import {
  classifyPreviewInterruption,
  ensurePreviewTitle,
  interruptToolSteps,
  previewAssistantMessageParts,
  turnInterruptedPart,
} from '@/lib/claude-code-preview/preview-transcript'

function insertBeforeFinalText(
  parts: UIMessage['parts'],
  inserted: UIMessage['parts'],
): UIMessage['parts'] {
  if (inserted.length === 0) return parts
  const finalTextIndex = parts.findLastIndex((part) => part.type === 'text')

  if (finalTextIndex < 0) return [...parts, ...inserted]

  return [...parts.slice(0, finalTextIndex), ...inserted, ...parts.slice(finalTextIndex)]
}

export async function finishPreviewTurn(args: {
  run: AgentRun
  diagnostics?: TurnDiagnostics
  sessionId: string
  teamId: string
  userId: string
  messages: UIMessage[]
  firstMessage: string
  locale: string
  provider: string
  requestId: string
  startedAt: number
  /** The final segment's text (after the last steering boundary). */
  text: string
  /** Every segment's text joined — what the turn answered overall. */
  answer: string
  reasoning: string
  /** Final segment parts in runtime arrival order. */
  orderedParts?: UIMessage['parts']
  toolSteps: PreviewToolStep[]
  /** Index into toolSteps where the final segment begins. */
  finalStepStart: number
  /** Steered exchange segments (assistant/user), in order, before the final. */
  steered: UIMessage[]
  memory: PreviewTurnMemory | null
  emit: (frame: Record<string, unknown>) => void
  onRuntimeComplete?: () => void
}): Promise<void> {
  const { run, sessionId, teamId, userId } = args
  const existingPlanIds = new Set(
    args.toolSteps.flatMap((step) => {
      if (step.toolName !== 'plan_create' || !step.output || typeof step.output !== 'object')
        return []
      const planId = (step.output as Record<string, unknown>).planId

      return typeof planId === 'string' ? [planId] : []
    }),
  )
  const nativePlans = await listPlansCreatedForConversation(sessionId, new Date(args.startedAt), {
    teamId,
    userId,
  }).catch(() => [])
  const nativePlanSteps: PreviewToolStep[] = nativePlans
    .filter((plan) => !existingPlanIds.has(plan.id))
    .map((plan) => ({
      toolCallId: `nuphos-plan-${plan.id}-${String(args.startedAt)}`,
      toolName: 'plan_create',
      input: { title: plan.title, overview: plan.overview },
      output: { planId: plan.id, status: plan.status },
    }))
  const toolSteps = [...args.toolSteps, ...nativePlanSteps]
  const nativePlanParts = previewAssistantMessageParts({
    reasoning: '',
    text: '',
    toolSteps: nativePlanSteps,
  })
  const fallbackParts = previewAssistantMessageParts({
    reasoning: args.reasoning,
    text: args.text,
    toolSteps: args.toolSteps.slice(args.finalStepStart),
  })
  const orderedParts = args.orderedParts ?? fallbackParts
  // Native Plan records are discovered after the runtime finishes and have no
  // stream event to place them precisely. Preserve their previous position
  // immediately before the final answer instead of moving the answer's
  // interleaved commentary and tools around them.
  const parts = insertBeforeFinalText(orderedParts, nativePlanParts)

  if (args.diagnostics) parts.push({ type: 'data-turn-diagnostics', data: args.diagnostics })
  const tail = [
    ...args.steered,
    ...(parts.length > 0 ? [{ id: randomUUID(), role: 'assistant' as const, parts }] : []),
  ]
  const transcriptMessages = uiMessagesToTranscript([...args.messages, ...tail])

  try {
    await syncConversationTranscript({
      sessionId,
      userId,
      teamId,
      title: '',
      firstMessage: getFirstTranscriptMessage(transcriptMessages, args.firstMessage || 'New chat'),
      messages: transcriptMessages,
      locale: args.locale,
      provider: args.provider,
      preserveTitle: true,
    })
    // Emit the stored timestamps too: download cards use them to stay with
    // their original turn instead of briefly piling onto the latest reply.
    const stored = await getConversationMessagesHead(sessionId, userId, transcriptMessages.length)

    args.emit({ type: 'atlas-transcript-snapshot', messages: stored.map(serializeMessageDoc) })
  } catch (err) {
    traceAgentChatError('agent.chat.preview_transcript_persist.error', err, run.trace, {
      message_count: transcriptMessages.length,
    })
  }
  // The durable answer is now available to every replica. Title generation
  // and memory enrichment must not prolong runtime execution in the UI.
  args.onRuntimeComplete?.()
  await ensurePreviewTitle({
    sessionId,
    userId,
    teamId,
    firstMessage: args.firstMessage,
    assistantResponse: args.answer,
    locale: args.locale,
  })
  if (args.memory) {
    const accumulator = args.memory.turnMemory.accumulator

    if (accumulator) {
      await mergePreviewMemoryActivity(accumulator, sessionId, args.requestId).catch(
        (err: unknown) => {
          traceAgentChatError('agent.chat.preview_memory_activity_merge.error', err, run.trace, {})
        },
      )
    }
    void ingestPreviewTurn({
      sessionId,
      userId,
      teamId,
      requestId: args.requestId,
      memory: args.memory,
      answer: args.answer,
      toolSteps,
      startedAt: args.startedAt,
      emitFrame: args.emit,
    }).catch((err: unknown) => {
      traceAgentChatError('agent.chat.preview_memory_ingest.error', err, run.trace, {})
    })
  }
}

/**
 * A turn that died (cancel, timeout, runtime error) still leaves what it did
 * so far in the transcript, plus a `turn-interrupted` part naming the cause —
 * otherwise a reopened conversation shows a user message with no answer and
 * no hint of what went wrong. The same part goes out as a stream frame for a
 * client still attached.
 */
export async function persistInterruptedPreviewTurn(args: {
  run: AgentRun
  diagnostics?: TurnDiagnostics
  sessionId: string
  teamId: string
  userId: string
  messages: UIMessage[]
  firstMessage: string
  locale: string
  provider: string
  text: string
  reasoning: string
  /** Final partial segment parts in runtime arrival order. */
  orderedParts?: UIMessage['parts']
  toolSteps: PreviewToolStep[]
  finalStepStart: number
  steered: UIMessage[]
  error: unknown
  emit: (frame: Record<string, unknown>) => void
}): Promise<void> {
  const { run, sessionId, teamId, userId } = args
  const interruption = classifyPreviewInterruption(args.error, run.abortController.signal.aborted)
  const part = {
    ...turnInterruptedPart(`${run.streamId}:interrupted`, interruption),
    ...(args.diagnostics ? { diagnostics: args.diagnostics } : {}),
  }

  args.emit(part)
  const parts = [
    ...partsWithoutFailureNotice(
      args.orderedParts ??
        previewAssistantMessageParts({
          reasoning: args.reasoning,
          text: args.text,
          toolSteps: interruptToolSteps(args.toolSteps.slice(args.finalStepStart)),
        }),
      args.error,
    ),
    part as unknown as UIMessage['parts'][number],
  ]
  const transcriptMessages = uiMessagesToTranscript([
    ...args.messages,
    ...args.steered,
    { id: randomUUID(), role: 'assistant', parts },
  ])

  try {
    await syncConversationTranscript({
      sessionId,
      userId,
      teamId,
      title: '',
      firstMessage: getFirstTranscriptMessage(transcriptMessages, args.firstMessage || 'New chat'),
      messages: transcriptMessages,
      locale: args.locale,
      provider: args.provider,
      preserveTitle: true,
    })
    // Emit the stored timestamps too: download cards use them to stay with
    // their original turn instead of briefly piling onto the latest reply.
    const stored = await getConversationMessagesHead(sessionId, userId, transcriptMessages.length)

    args.emit({ type: 'atlas-transcript-snapshot', messages: stored.map(serializeMessageDoc) })
  } catch (err) {
    traceAgentChatError('agent.chat.preview_interrupted_persist.error', err, run.trace, {
      message_count: transcriptMessages.length,
      reason: interruption.reason,
    })
  }
}

/**
 * A draining replica lets go of a turn the runtime is still running. What
 * streamed so far is saved as-is; the replica that adopts the session saves
 * the rest as the next assistant message.
 */
export async function persistHandedOffPreviewTurn(args: {
  run: AgentRun
  sessionId: string
  teamId: string
  userId: string
  messages: UIMessage[]
  firstMessage: string
  locale: string
  provider: string
  orderedParts: UIMessage['parts']
  steered: UIMessage[]
}): Promise<void> {
  const transcriptMessages = uiMessagesToTranscript([
    ...args.messages,
    ...args.steered,
    ...(args.orderedParts.length > 0
      ? [{ id: randomUUID(), role: 'assistant' as const, parts: args.orderedParts }]
      : []),
  ])

  try {
    await syncConversationTranscript({
      sessionId: args.sessionId,
      userId: args.userId,
      teamId: args.teamId,
      title: '',
      firstMessage: getFirstTranscriptMessage(transcriptMessages, args.firstMessage || 'New chat'),
      messages: transcriptMessages,
      locale: args.locale,
      provider: args.provider,
      preserveTitle: true,
    })
  } catch (err) {
    traceAgentChatError('agent.chat.preview_handoff_persist.error', err, args.run.trace, {
      message_count: transcriptMessages.length,
    })
  }
}
