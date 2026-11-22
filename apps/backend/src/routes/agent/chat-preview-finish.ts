// The tail of a Claude Code preview turn, mirroring the classic onFinish:
// persist the assistant message (and any steered exchange segments) with
// their tool steps, give the conversation a title, and record what the
// agent's memory tools did this turn.

import { appendTranscriptMessages } from '@/lib/agent/db'
import { deliverWaitingAnswers } from '@/lib/agent/deliver-waiting-answers'
import { mergePreviewMemoryActivity } from '@/lib/agent/memory-slots/preview-activity-store'
import { partsWithoutFailureNotice } from '@/lib/claude-code-preview/codex-turn-failure'
import { completedTurnOutput } from '@/lib/claude-code-preview/empty-turn'
import {
  classifyPreviewInterruption,
  interruptToolSteps,
  previewAssistantMessageParts,
  turnInterruptedPart,
} from '@/lib/claude-code-preview/preview-transcript'

import { finishPreviewTurnMemory } from './chat-preview-memory'
import { traceAgentChatError } from './trace'
import { getFirstTranscriptMessage, uiMessagesToTranscript } from './transcript'
import { storedTranscriptTail } from './transcript-tail'

import type { PreviewTurnMemory } from './chat-preview-memory'
import type { AgentRun } from './types'
import type { PreviewToolStep } from '@/lib/claude-code-preview/preview-transcript'
import type { TurnDiagnostics } from '@/lib/claude-code-preview/turn-diagnostics'
import type { UIMessage } from 'ai'

/**
 * The id a run's reply is stored under: its stream's, which every client that
 * streamed the turn already knows. A client gives its live reply the same id, so
 * the stored transcript replaces it as the same message and nothing drawn in it
 * is thrown away. A turn handed on to another run stores one reply per run.
 */
function replyMessageId(run: AgentRun): string {
  return run.streamId
}

export async function finishPreviewTurn(args: {
  run: AgentRun
  sessionId: string
  teamId: string
  userId: string
  messages: UIMessage[]
  firstMessage: string
  locale: string
  provider: string
  requestId: string
  /** The final segment's text (after the last steering boundary). */
  text: string
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
  const fallbackParts = previewAssistantMessageParts({
    reasoning: args.reasoning,
    text: args.text,
    toolSteps: args.toolSteps.slice(args.finalStepStart),
  })
  const { parts, steered } = completedTurnOutput(args.orderedParts ?? fallbackParts, args.steered)

  const tail = [
    ...steered,
    // Preserve the completion boundary even when there is no visible output:
    // thread-delivery replay deduplicates messages before the last assistant.
    { id: replyMessageId(run), role: 'assistant' as const, parts },
  ]
  const transcriptMessages = uiMessagesToTranscript([...args.messages, ...tail])

  try {
    const stored = await appendTranscriptMessages({
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

    args.emit(await storedTranscriptTail(sessionId, userId, teamId, stored, tail.length))
  } catch (err) {
    traceAgentChatError('agent.chat.preview_transcript_persist.error', err, run.trace, {
      message_count: transcriptMessages.length,
    })
  }
  // The durable answer is now available to every replica. Memory enrichment
  // must not prolong runtime execution in the UI.
  args.onRuntimeComplete?.()
  // The agent can run again: an answer that waited for it goes next.
  void deliverWaitingAnswers(sessionId)
  if (args.memory) {
    const accumulator = args.memory.turnMemory.accumulator

    if (accumulator) {
      await mergePreviewMemoryActivity(accumulator, sessionId, args.requestId).catch(
        (err: unknown) => {
          traceAgentChatError('agent.chat.preview_memory_activity_merge.error', err, run.trace, {})
        },
      )
    }
    void finishPreviewTurnMemory({
      sessionId,
      userId,
      teamId,
      requestId: args.requestId,
      memory: args.memory,
      emitFrame: args.emit,
    }).catch((err: unknown) => {
      traceAgentChatError('agent.chat.preview_memory_finish.error', err, run.trace, {})
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
    { id: replyMessageId(run), role: 'assistant', parts },
  ])

  try {
    const stored = await appendTranscriptMessages({
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

    args.emit(
      await storedTranscriptTail(sessionId, userId, teamId, stored, args.steered.length + 1),
    )
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
      ? [{ id: replyMessageId(args.run), role: 'assistant' as const, parts: args.orderedParts }]
      : []),
  ])

  try {
    await appendTranscriptMessages({
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
