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
import { renderAttributedMessage } from '@/lib/agent/message-metadata'
import { drainPendingUserMessages, renderInjectedUserMessages } from '@/lib/agent/pending-messages'
import { previewHistoryPreamble } from '@/lib/claude-code-preview/preview-history-preamble'
import { buildPreviewSystemPrompt } from '@/lib/claude-code-preview/preview-prompt'
import { prefixUserMessage, recallForPreviewTurn } from '@/lib/claude-code-preview/preview-recall'
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

export function lastUserMessageText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages.at(index)

    if (message?.role !== 'user') continue

    const text = message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && Boolean(p.text))
      .map((p) => p.text)
      .join('\n\n')

    return renderAttributedMessage(message.id, text, message.metadata)
  }

  return ''
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
  message: string
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
  const [memory, systemPrompt, compactionSummary, carried] = await Promise.all([
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
    drainPendingUserMessages(userId, sessionId, actorUserId),
  ])
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
  const lastUserText =
    resumeMessage(args.resume) ?? inputs.map((m) => lastUserMessageText([m])).join('\n\n')

  if (memory) emitRecallStartFrame(args.run, sessionId, requestId, memory.recall)
  const carriedBlock = carried.length > 0 ? `\n\n${renderInjectedUserMessages(carried)}` : ''
  const recallBlock = memory?.recall.memoryBlock ?? null

  return {
    memory,
    attachments,
    systemPrompt,
    message: prefixUserMessage(`${lastUserText}${carriedBlock}`, recallBlock),
    freshSessionMessage: (uncertain?: boolean) => {
      const preamble = previewHistoryPreamble(
        messages,
        compactionSummary,
        uncertain,
        args.resume ? 0 : inputs.length,
      )
      const history = preamble ? `${preamble}\n\n` : ''

      return prefixUserMessage(`${history}${lastUserText}${carriedBlock}`, recallBlock)
    },
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
export function carriedUserMessages(carried: PendingUserMessage[]): UIMessage[] {
  return carried.map((entry) => ({
    id: entry.id,
    role: 'user',
    metadata: entry.metadata,
    parts: [{ type: 'text', text: entry.renderedText }],
  }))
}
