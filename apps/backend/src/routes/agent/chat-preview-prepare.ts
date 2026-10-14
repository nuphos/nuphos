// Pre-prompt assembly for a Claude Code runtime turn: memory recall, the
// composed system prompt, the history preamble for a fresh inner session, and
// any messages queued while no turn was running (they ride the first prompt).

import {
  clearConversationPreviewLocalTools,
  clearConversationPreviewTurn,
  openConversationPromptSuggestion,
  setConversationPreviewContext,
} from '@/lib/agent/db'
import { promptImages } from '@/lib/agent/image-parts'
import {
  attributionHeader,
  parseMessageMetadata,
  renderAttributedMessage,
} from '@/lib/agent/message-metadata'
import {
  drainPendingUserMessages,
  enqueuePendingUserMessage,
  renderInjectedUserMessages,
  TRANSCRIPT_SOURCES,
} from '@/lib/agent/pending-messages'
import { previewHistoryPreamble } from '@/lib/claude-code-preview/preview-history-preamble'
import { buildPreviewSystemPrompt } from '@/lib/claude-code-preview/preview-prompt'
import { recallForPreviewTurn } from '@/lib/claude-code-preview/preview-recall'
import { previewCompactionSummary } from '@/lib/claude-code-preview/preview-transcript'
import { runtimeAttachments } from '@/lib/claude-code-preview/runtime-attachments'

import { emitRecallStartFrame } from './chat-prep'
import { traceAgentChatError } from './trace'
import { getUserMessageTexts } from './transcript'
import { turnInputMessages } from './turn-start-frame'

import type { PreviewChatTurnArgs } from './chat-preview-turn'
import type { AgentChatBody } from './types'
import type { PendingUserMessage } from '@/lib/agent/pending-messages'
import type { PreviewTurnMemory } from '@/lib/claude-code-preview/preview-recall'
import type { RuntimeAttachment } from '@/lib/claude-code-preview/runtime-attachments'
import type { UIMessage } from 'ai'

type ResumeReason = NonNullable<AgentChatBody['resumeReason']>

function userText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && Boolean(p.text))
    .map((p) => p.text)
    .join('\n\n')
}

export function lastUserMessageText(messages: UIMessage[]): string {
  const message = messages.findLast((m) => m.role === 'user')

  return message ? renderAttributedMessage(message.id, userText(message), message.metadata) : ''
}

/**
 * The history a turn prompts from. A new turn answers the newest user message;
 * a retry of a failed turn ends on that attempt's stored reply, which must not
 * hide the message being retried.
 */
export function turnPromptMessages(
  messages: UIMessage[],
  resume: PreviewChatTurnArgs['resume'],
): UIMessage[] {
  if (resume) return messages

  return messages.slice(0, messages.findLastIndex((m) => m.role === 'user') + 1)
}

/**
 * Splits a turn into the user's own words, prompted last where the agent reads
 * a slash command, and everything Nuphos adds ahead of them. The current
 * message's header ends that lead, so only attachment links separate it from
 * its words. A resume replaces the turn's messages, as it is not a new request.
 */
export function turnPrompt(args: {
  resume: string | null
  inputs: UIMessage[]
  turnContext?: string
  carried: string
  recall?: string | null
}): { lead: (history?: string | null) => string; text: string } {
  const final = args.resume === null ? args.inputs.at(-1) : undefined
  // Only a verified sender's words take the last block; an unattested message
  // stays fenced in the lead even when nothing was said after it.
  const last = parseMessageMetadata(final?.metadata)?.unattested ? undefined : final
  const turn =
    args.resume === null
      ? [
          args.turnContext,
          ...(last ? args.inputs.slice(0, -1) : args.inputs).map((m) => lastUserMessageText([m])),
        ]
      : []
  const header = last ? attributionHeader(last.id, last.metadata) : ''

  return {
    lead: (history) =>
      [history, ...turn, args.carried, args.recall, header].filter(Boolean).join('\n\n'),
    text: args.resume ?? (last ? userText(last) : ''),
  }
}

const RESUME_MESSAGE: Record<ResumeReason, string> = {
  'permission-decision':
    'The permission proposal you were waiting on has been decided in Nuphos. Read the ' +
    'decision from the proposal and carry on with the original task from there.',
  'approval-decision':
    'The command authorization you were waiting on has been decided in Nuphos. Carry ' +
    'on with the original task from that outcome.',
  'client-tool':
    'Nuphos Desktop has reported the local tool result. Carry on with the original task ' +
    'from there.',
}

const RESUME_FALLBACK =
  'Carry on with the task you were working on, from where the previous turn stopped.'

/**
 * A resume is not a new request: replaying the user's last message would make
 * the runtime redo work it has already done in this same native session.
 */
export function resumeMessage(resume: PreviewChatTurnArgs['resume']): string | null {
  if (!resume) return null

  return (resume.reason ? RESUME_MESSAGE[resume.reason] : undefined) ?? RESUME_FALLBACK
}

/**
 * The desktop's per-turn context, which MCP handlers read back. Every field but
 * one is best-effort; `localTools` is not, because a stale `true` left by an
 * earlier Desktop turn would let this one publish a tool its client cannot run.
 */
export async function persistPreviewTurnContext(
  args: PreviewChatTurnArgs,
  requestId: string,
): Promise<void> {
  try {
    await setConversationPreviewContext(args.sessionId, args.teamId, {
      activeTurnKey: requestId,
      activeTurnOrigin: args.origin,
      ...(args.localToolsEnabled ? { localTools: true } : {}),
      ...(args.diagramId ? { diagramId: args.diagramId } : {}),
      ...(args.kubeContext ? { kubeContext: args.kubeContext } : {}),
    })

    return
  } catch (err: unknown) {
    traceAgentChatError('agent.chat.preview_context.error', err, args.run.trace, {})
  }
  // A stale `true` left by an earlier turn is this turn's own answer anyway.
  if (args.localToolsEnabled) return
  // This client runs no local tools, so it must not inherit an earlier Desktop
  // turn's capability. If the revoke cannot land either, the turn stops rather
  // than run with a capability nothing can substantiate.
  await clearConversationPreviewLocalTools(args.sessionId, args.teamId)
}

export type PreparedPreviewTurn = {
  memory: PreviewTurnMemory | null
  systemPrompt: string | undefined
  /** Everything but the user's own words, prompted ahead of them. */
  message: string
  /** The user's own words, prompted last so a leading slash command reaches the agent. */
  text: string
  attachments: RuntimeAttachment[]
  freshSessionMessage: (uncertain?: boolean) => string
  /** Queued-while-idle messages folded into the first prompt; persisted too. */
  carried: PendingUserMessage[]
  clearActiveTurn: () => Promise<void>
  openPromptSuggestion: () => Promise<void>
}

export async function preparePreviewTurn(
  args: PreviewChatTurnArgs,
  requestId: string,
): Promise<PreparedPreviewTurn> {
  const { sessionId, userId, teamId } = args
  const actorUserId = args.actorUserId ?? userId
  const userTexts = getUserMessageTexts(args.messages)

  await persistPreviewTurnContext(args, requestId)
  const [memory, systemPrompt, compactionSummary, drained] = await Promise.all([
    recallForPreviewTurn({
      sessionId,
      userId: actorUserId,
      teamId,
      requestId,
      messages: args.messages,
    }).catch((err: unknown): PreviewTurnMemory | null => {
      traceAgentChatError('agent.chat.preview_recall.error', err, args.run.trace, {})

      return null
    }),
    buildPreviewSystemPrompt({
      provider: args.endpoint.provider,
      userId: actorUserId,
      conversationOwnerUserId: userId,
      teamId,
      sessionId,
      locale: args.locale,
      userTexts,
      ...(args.kubeContext ? { kubeContext: args.kubeContext } : {}),
      ...(args.diagramId ? { diagramId: args.diagramId } : {}),
      ...(args.currentUrl ? { currentUrl: args.currentUrl } : {}),
      ...(args.slackThread ? { slackThread: args.slackThread } : {}),
    }).catch((err: unknown): string | undefined => {
      traceAgentChatError('agent.chat.preview_prompt.error', err, args.run.trace, {})

      return undefined
    }),
    previewCompactionSummary(sessionId, userId),
    drainTurnQueue(userId, sessionId, actorUserId, args.channelTurn),
  ])
  // A channel that syncs its thread into the transcript may already hold a queued message.
  const carried = drained.filter((entry) => !args.messages.some((m) => m.id === entry.id))
  const messages = turnPromptMessages(args.messages, args.resume)
  const inputs = turnInputMessages(messages)
  const images = args.resume ? [] : inputs.flatMap((m) => promptImages(m.parts))
  const attachments = args.resume
    ? []
    : await runtimeAttachments(
        inputs.flatMap((m) => m.parts),
        { teamId, userId: actorUserId, sessionId },
        images,
      )

  if (memory) emitRecallStartFrame(args.run, sessionId, requestId, memory.recall)
  const { lead, text } = turnPrompt({
    resume: resumeMessage(args.resume),
    inputs,
    turnContext: args.turnContext,
    carried: carried.length > 0 ? renderInjectedUserMessages(carried) : '',
    recall: memory?.recall.memoryBlock,
  })

  return {
    memory,
    attachments,
    systemPrompt,
    message: lead(),
    text,
    freshSessionMessage: (uncertain?: boolean) =>
      lead(
        previewHistoryPreamble(
          messages,
          compactionSummary,
          uncertain,
          args.resume ? 0 : inputs.length,
        ),
      ),
    carried,
    clearActiveTurn: () =>
      clearConversationPreviewTurn(sessionId, teamId, requestId).catch((err: unknown) => {
        traceAgentChatError('agent.chat.preview_active_turn_clear.error', err, args.run.trace, {})
      }),
    openPromptSuggestion: () =>
      openConversationPromptSuggestion(sessionId, teamId, requestId).catch((err: unknown) => {
        traceAgentChatError('agent.chat.prompt_suggestion_open.error', err, args.run.trace, {})
      }),
  }
}

/** The carried queue as transcript messages (empty when nothing was queued). */
/** A channel message is answered in its channel, so only a turn there takes it. */
export function drainTurnQueue(
  userId: string,
  sessionId: string,
  actorUserId: string,
  channelTurn?: boolean,
) {
  return drainPendingUserMessages(
    userId,
    sessionId,
    actorUserId,
    channelTurn ? undefined : TRANSCRIPT_SOURCES,
  )
}

export function carriedUserMessages(carried: PendingUserMessage[]): UIMessage[] {
  return carried.map((entry) => ({
    id: entry.id,
    role: 'user',
    metadata: entry.metadata,
    parts: [{ type: 'text', text: entry.renderedText }],
  }))
}

/**
 * A refused turn never reached the agent. When its client resends the message, the
 * queued messages it drained go back on the queue for that resent turn.
 */
export async function requeueCarried(
  userId: string,
  sessionId: string,
  carried: PendingUserMessage[],
) {
  for (const entry of carried) await enqueuePendingUserMessage(userId, sessionId, entry)
}
