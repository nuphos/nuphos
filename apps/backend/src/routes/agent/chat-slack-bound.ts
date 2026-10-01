import type { AgentChatBody } from './types'
import type { SlackAgentThread } from '@/lib/slack/agent-bot'
import type { UIMessage } from 'ai'

import { getConversationWithMessages } from '@/lib/agent/db'
import { assertSingleNewUserMessage } from '@/lib/agent/message-input'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
// A Slack-bound conversation continued from the Nuphos app: the owner's turn
// runs through the normal /agent/chat pipeline (native SSE streaming,
// attachments, local tools), while a Slack mirror posts the question and the
// reply into the bound thread. This module keeps the chat route's branch thin:
// binding lookup, the per-session claim shared with the Slack bridges, the
// transcript merge, and the lazy handoff to the Slack delivery module.
//
// The thread lookup lives against lib/slack directly; the delivery setup is a
// dynamic import because `@/routes/slack` transitively imports routes/agent —
// same constraint as lib/agent/plan-slack-resume.ts.
import { parseAgentMessageOrigin } from '@/lib/agent/message-origin'
// The claim goes through the turn-runner seam like the Slack bridges' claims
// do — a static ./run-registry import would make this module a second entry
// point into the routes/agent cycle (run-registry → constants → tool barrels
// → back into @/routes/agent), which explodes when a test loads this file
// first.
import { turnRunner } from '@/lib/agent/turn-runner'
import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'
import { getSlackAgentThreadBySessionId } from '@/lib/slack/agent-bot'
// Leaf-module import, NOT the `@/routes/slack` barrel: messages.ts only
// depends on lib/agent, so this stays cycle-free where the barrel would not.
import { persistedPartToUiMessagePart } from '@/routes/slack/messages'

type BeginNuphosSlackTurn = (typeof import('@/routes/slack'))['beginNuphosSlackTurn']
export type SlackBoundTurnDelivery = NonNullable<Awaited<ReturnType<BeginNuphosSlackTurn>>>

/** The client's new user message to mirror into the bound thread. */
export type SlackMirrorPayload = {
  messageId: string
  questionText: string
  attachmentCount: number
}

export type SlackBoundTurnPlan = {
  /** The merged message list this turn runs and persists. */
  messages: UIMessage[]
  /**
   * Null when nothing new should be mirrored: a continuation (client-tool
   * outputs, pause resume) or a retry whose message the store already holds
   * (the accepted run already mirrored it).
   */
  mirror: SlackMirrorPayload | null
}

/**
 * The Slack thread this session is bound to, or null for the common case.
 *
 * On a lookup failure the answer depends on what we can prove: a conversation
 * whose `metadata.source` says it is Slack-originated MUST fail closed —
 * running it without the claim and merge could delete Slack-side messages —
 * while any other conversation proceeds un-mirrored, because the Slack thread
 * store being down must not take down ordinary chat.
 */
export async function findSlackBoundThread(
  sessionId: string,
  conversationSource: string | undefined,
): Promise<SlackAgentThread | null> {
  try {
    return await getSlackAgentThreadBySessionId(sessionId)
  } catch (err) {
    logError('agent.chat.slack_thread_lookup.error', err, { session_id: sessionId })
    if (conversationSource?.startsWith('slack.')) {
      throw new AppError(
        503,
        'slack_thread_lookup_failed',
        'Could not check the linked Slack thread. Try again in a moment.',
      )
    }

    return null
  }
}

/**
 * Whether the transcript PUT must be refused for this session. Slack-bound
 * conversations are server-authoritative: turns persist their own transcripts
 * (the merge above, under the session claim), and the PUT's delete-absent
 * semantics would let any client view that missed a Slack-side exchange erase
 * it — including already-shipped desktop builds that predate their
 * renderer-side guard. Fails closed on a lookup error: skipping a sync is
 * recoverable, a deleted exchange is not.
 */
export async function isTranscriptSyncBlockedBySlackBinding(sessionId: string): Promise<boolean> {
  return await getSlackAgentThreadBySessionId(sessionId)
    .then((thread) => thread !== null)
    .catch(() => true)
}

/**
 * Take the same per-session claim the Slack bridges take, so a thread reply
 * arriving mid-turn queues behind this run (and vice versa: this send is
 * refused while a Slack-side reply is running). Throws 409 conversation_busy
 * when the session is taken — the client renders it as a friendly notice.
 */
export async function claimSlackBoundTurn(
  runOwnerUserId: string,
  sessionId: string,
): Promise<() => void> {
  const claim = await turnRunner.claimAgentRunForSession(runOwnerUserId, sessionId)

  if (!claim) {
    throw new AppError(
      409,
      'conversation_busy',
      'The agent is currently replying in the linked Slack thread. Send your message again once that reply finishes.',
    )
  }

  return claim
}

/**
 * Set up the Slack mirror for this turn. Fail-open: any setup failure returns
 * null and the turn runs un-mirrored — a Slack-side outage must not take away
 * the owner's ability to use their own conversation.
 */
export async function beginSlackBoundTurnDelivery(
  args: {
    thread: SlackAgentThread
    userId: string
    userName: string
    streamId: string
    mirror: SlackMirrorPayload | null
    /** Subscribes the mirror sink to the run's frames the moment it exists. */
    attach?: (frameSink: SlackBoundTurnDelivery['frameSink']) => void
  },
  // Injected by tests, same rationale as lib/agent/plan-slack-resume.ts.
  begin?: BeginNuphosSlackTurn,
): Promise<SlackBoundTurnDelivery | null> {
  try {
    const beginNuphosSlackTurn = begin ?? (await import('@/routes/slack')).beginNuphosSlackTurn
    const delivery = await beginNuphosSlackTurn({
      thread: args.thread,
      userId: args.userId,
      userName: args.userName,
      streamId: args.streamId,
      mirror: args.mirror,
    })

    if (delivery) args.attach?.(delivery.frameSink)

    return delivery
  } catch {
    // beginNuphosSlackTurn logs its own failures; an import/setup throw here
    // still must not fail the turn.
    return null
  }
}

/**
 * Build the message list a Slack-bound turn runs and persists, and decide
 * what to mirror. Must run UNDER the per-session claim (the store snapshot
 * would otherwise race a finishing Slack turn).
 *
 * The list is a merge, never a replacement, because both sides hold truth the
 * other lacks: the store has Slack-side exchanges a stale desktop tab never
 * saw (and the accepted-turn sync deletes what the list omits), while the
 * client view has newer content for its own messages — local tool outputs on
 * a client-tool continuation, the partial assistant text on a pause resume,
 * and user messages a refused send left behind. So: store order wins, a
 * client copy replaces the store copy on id collision, and client-only
 * messages append at the end.
 */
export async function buildSlackBoundTurnPlan(args: {
  body: AgentChatBody
  clientView: UIMessage[]
  serverHistoryOnly?: boolean
  sessionId: string
  runOwnerUserId: string
  teamId: string | undefined
}): Promise<SlackBoundTurnPlan> {
  const { body, clientView } = args
  const existing = await getConversationWithMessages(
    args.sessionId,
    args.runOwnerUserId,
    args.teamId,
  )
  const stored = (existing?.messages ?? [])
    .map(persistedMessageToLosslessUiMessage)
    .filter((message): message is UIMessage => message !== null)
  const storedIds = new Set(stored.map((message) => message.id))

  if (args.serverHistoryOnly) assertSingleNewUserMessage(clientView, storedIds)
  const clientById = new Map(clientView.map((message) => [message.id, message]))
  const messages = [
    ...stored.map((message) =>
      args.serverHistoryOnly ? message : (clientById.get(message.id) ?? message),
    ),
    ...clientView.filter(
      (message) =>
        !storedIds.has(message.id) &&
        (!args.serverHistoryOnly || (message === clientView.at(-1) && message.role === 'user')),
    ),
  ]

  if (!messages.some((message) => message.role === 'user')) {
    throw new AppError(400, 'invalid_request', 'A Slack-bound turn needs a user message')
  }
  body.messages = messages

  // Mirror only a genuinely NEW user turn: the client's list must end with a
  // user message (a client-tool continuation ends with the assistant message
  // carrying tool outputs), not be a pause continuation, and not be a retry
  // of a message the store already holds (the accepted run mirrored it).
  const lastClient = clientView[clientView.length - 1]
  const isFreshUserTurn = lastClient?.role === 'user' && body.continueAfterInterruption !== true

  if (!isFreshUserTurn) return { messages, mirror: null }
  if (storedIds.has(lastClient.id)) {
    logEvent('info', 'agent.chat.slack_bound.duplicate_user_message', {
      session_id: args.sessionId,
      message_id: lastClient.id,
    })

    return { messages, mirror: null }
  }

  return { messages, mirror: userMessagePreview(lastClient) }
}

// Lossless round-trip of a stored message back into UIMessage form: compact
// 'tool' parts re-expand (the model needs `tool-<name>`), everything else —
// file, image, reasoning, data-* — passes through verbatim. Dropping unknown
// parts here would be a one-way door: the turn's accepted persist rewrites
// the store with this list, so a filtered copy permanently strips attachments
// from the transcript.
function persistedMessageToLosslessUiMessage(message: {
  messageId: string
  role: string
  parts: unknown[]
  metadata?: unknown
  origin?: unknown
}): UIMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const parts = message.parts.flatMap((part) => {
    const converted = persistedPartToUiMessagePart(part)

    if (converted.length > 0) return converted
    const type = part && typeof part === 'object' ? (part as { type?: unknown }).type : undefined

    return typeof type === 'string' ? [part] : []
  })

  if (parts.length === 0) return null
  const origin = parseAgentMessageOrigin(message.origin)
  const attribution = parseMessageMetadata(message.metadata)

  return {
    id: message.messageId,
    role: message.role,
    parts,
    ...(origin || attribution
      ? { metadata: { ...attribution, ...(origin ? { origin } : {}) } }
      : {}),
  } as UIMessage
}

function userMessagePreview(message: UIMessage): SlackMirrorPayload {
  const texts: string[] = []
  let attachmentCount = 0

  for (const part of message.parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      if (part.text.trim()) texts.push(part.text)
    } else if (part.type !== 'step-start') {
      attachmentCount += 1
    }
  }

  return {
    messageId: message.id,
    questionText: texts.join('\n\n').trim(),
    attachmentCount,
  }
}
