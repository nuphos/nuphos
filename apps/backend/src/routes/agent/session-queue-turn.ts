// The server queue is a session's only queue. A client that declares
// `serverQueue` sends every message at once: it runs now when the session is
// free, or waits in the queue behind whatever arrived first, human or agent.
// The release that frees the session starts the next one (startQueuedTurn).
import { randomUUID } from 'node:crypto'

import { agentMessages } from '@/lib/agent/db'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import { buildPendingUserMessage, enqueuePendingUserMessage } from '@/lib/agent/pending-messages'
import { hasQueuedTranscriptMessage } from '@/lib/agent/pending-queue'
import { sessionReleased } from '@/lib/agent/session-released'
import { startTraceSpan } from '@/lib/agent/tracing'
import { resolveConversationChatRuntime } from '@/lib/claude-code-preview/agent-chat-runtime'
import { refusal } from '@/lib/claude-code-preview/runtime-refusal'
import { AppError } from '@/lib/errors'
import { signNuphosToken } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

import { launchAcceptedChatTurn } from './chat-post-run'
import { buildSlackBoundTurnPlan } from './chat-slack-bound'
import { claimAgentRunForSession, createAgentRun } from './run-registry'
import { getFirstUserMessage } from './transcript'
import { acceptAgentRun } from './turn-start-frame'

import type { AgentChatBody, AgentRunTrace, InternalChatCtx } from './types'
import type { AgentConversation, AgentCredentialAccess } from '@/lib/agent/db'
import type { PendingUserMessage, QueuedChatTurn } from '@/lib/agent/pending-message-types'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'
import type { UIMessage } from 'ai'
import type { Context } from 'hono'

const QUEUED_TOKEN_TTL_SECONDS = 8 * 60 * 60

export type QueueableChat = {
  body: AgentChatBody
  conversation: AgentConversation | null
  runOwnerUserId: string
  userId: string
  streamId: string
  readOnlyResume: boolean
  clientView: UIMessage[]
  snapshot: SessionExecutionState | undefined
  slackBound: boolean
  context: Omit<QueuedChatTurn, 'streamId' | 'message' | 'credentialAccess'>
  credentialAccess: AgentCredentialAccess | undefined
  /** Its Box is offline and resuming: the message waits in the queue for it. */
  runtimeOffline?: boolean
}

/** The per-turn desktop context a queued send runs with later. */
export function queuedChatContext(
  c: Context,
  locale: string,
  localTools: boolean,
  kubeContext: string | undefined,
): QueueableChat['context'] {
  const diagramId = c.req.header('X-Atlas-Diagram-Id')?.trim()

  return {
    locale,
    localTools,
    currentUrl:
      c.req.header('X-Atlas-Url') ?? c.req.header('referer') ?? c.req.header('origin') ?? null,
    ...(kubeContext ? { kubeContext } : {}),
    ...(diagramId ? { diagramId } : {}),
  }
}

function messageText(message: UIMessage): string {
  return message.parts
    .flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
    .join('\n\n')
}

// A queued id is shown to everyone in the conversation and removed by value.
const QUEUED_ID = /^[\w-]{1,128}$/
// Attachments are references; this bounds what one waiting message stores.
const MAX_QUEUED_MESSAGE_CHARS = 256_000

/** A new message, not a continuation, reply or Slack-bound turn, in an existing conversation. */
function freshSend({ body, conversation, ...args }: QueueableChat): AgentConversation | null {
  const fresh =
    !args.readOnlyResume && !body.resume && !body.resumeReason && !body.continueAfterInterruption

  if (!fresh || args.slackBound || args.clientView.at(-1)?.role !== 'user') return null

  return conversation
}

/**
 * The session claim when the message runs now, 'queued' when it waits. Null
 * leaves the request to the older admission (continuations, replies,
 * Slack-bound and new conversations), which an older client's new message
 * also takes once nothing waits ahead of it.
 */
export async function admitQueueableChat(
  args: QueueableChat,
): Promise<
  { mode: 'run'; release: () => void; item: PendingUserMessage } | { mode: 'queued' } | null
> {
  const conversation = freshSend(args)
  const message = args.clientView.at(-1)

  if (!conversation || !message) return null
  if (args.body.clientCapabilities?.serverQueue !== true) {
    // An older client resends a refused message, so it waits its turn too.
    if (await hasQueuedTranscriptMessage(args.runOwnerUserId, conversation.sessionId))
      throw refusal('Messages sent earlier are still waiting for the agent')

    return null
  }
  // Without an authoritative runtime status the earlier admission answers 503.
  if (conversation.claudeCodePreview && args.snapshot?.schemaVersion !== 2 && !args.runtimeOffline)
    return null
  if (!QUEUED_ID.test(message.id))
    throw new AppError(400, 'invalid_request', 'A message id may use letters, digits, - and _')
  if (JSON.stringify(message).length > MAX_QUEUED_MESSAGE_CHARS)
    throw new AppError(413, 'message_too_large', 'This message is too large to send')
  const owner = args.runOwnerUserId
  const sessionId = conversation.sessionId
  // Nothing overtakes a message that is already waiting.
  const release = (await hasQueuedTranscriptMessage(owner, sessionId))
    ? null
    : await claimAgentRunForSession(owner, sessionId)
  // Runtime-owned work (an automatic continuation) holds no backend claim.
  const runtimeBusy =
    args.runtimeOffline === true ||
    (args.snapshot?.schemaVersion === 2 && !args.snapshot.actions?.send)

  const item: PendingUserMessage = {
    ...buildPendingUserMessage({
      renderedText: messageText(message),
      source: 'app',
      actorUserId: args.userId,
      metadata: parseMessageMetadata(message.metadata),
    }),
    id: message.id,
    chat: {
      ...args.context,
      streamId: args.streamId,
      message,
      ...(args.credentialAccess ? { credentialAccess: args.credentialAccess } : {}),
    },
  }

  // Run now; a runtime refusal mid-start puts it at the head of the queue.
  if (release && !runtimeBusy) return { mode: 'run', release, item }
  const queued = await enqueuePendingUserMessage(owner, sessionId, item)

  // Letting go of the claim starts the queue; otherwise nudge it ourselves.
  if (release) release()
  else sessionReleased(owner, sessionId)
  if (!queued)
    throw new AppError(
      409,
      'message_queue_full',
      'Too many messages are waiting for this agent. Try again after it answers some.',
    )
  logEvent('info', 'agent.chat.queued', {
    user_id: args.userId,
    session_id: sessionId,
    message_id: message.id,
    stream_id: args.streamId,
    runtime_busy: runtimeBusy,
  })

  return { mode: 'queued' }
}

/**
 * Runs a queued app send as its sender's chat turn, with the context and stream
 * the sender's device sent it with. The caller's session claim passes to the
 * turn, which lets go of it when it ends.
 */
export async function launchQueuedChatTurn(
  conversation: AgentConversation,
  item: PendingUserMessage & { chat: QueuedChatTurn },
  releaseClaim: () => void,
): Promise<void> {
  const { chat } = item
  const sessionId = conversation.sessionId
  const teamId = conversation.teamId
  const actorUserId = item.actorUserId ?? conversation.userId

  if (!teamId) throw new Error('A queued message lost its conversation team.')
  // A refused attempt already persisted its input before calling the runtime.
  // Only unattempted deliveries can use input presence as the duplicate guard:
  // a counted retry explicitly did not run and still needs to reach the agent.
  const retrying = (item.attempts ?? 0) > 0

  if (
    !retrying &&
    (await agentMessages().findOne(
      { sessionId, userId: conversation.userId, messageId: item.id },
      { projection: { _id: 1 } },
    ))
  ) {
    releaseClaim()

    return
  }
  const body: AgentChatBody = {
    id: sessionId,
    teamId,
    messages: [chat.message],
    streamId: chat.streamId,
    clientCapabilities: { localTools: chat.localTools, serverQueue: true },
  }
  const { messages } = await buildSlackBoundTurnPlan({
    body,
    clientView: [chat.message],
    serverHistoryOnly: true,
    sessionId,
    runOwnerUserId: conversation.userId,
    teamId,
  })
  const chatRuntime = await resolveConversationChatRuntime(teamId, conversation, {
    userId: actorUserId,
  })
  const requestId = randomUUID()
  const chatSpan = startTraceSpan({
    name: 'turn',
    type: 'task',
    metadata: { route: '/agent/chat', method: 'QUEUED', requestId, sessionId, teamId },
  })
  const chatCtx: InternalChatCtx = {
    requestId,
    streamId: chat.streamId,
    userId: actorUserId,
    nuphosToken: signNuphosToken(actorUserId, QUEUED_TOKEN_TTL_SECONDS),
    locale: chat.locale,
    currentUrl: chat.currentUrl ?? null,
    localToolsEnabled: chat.localTools,
    kubeContext: chat.kubeContext,
    diagramId: chat.diagramId,
    isInApp: true,
    agentOrigin: 'user',
  }
  const runTrace: AgentRunTrace = {
    requestId,
    userId: actorUserId,
    sessionId,
    teamId,
    streamId: chat.streamId,
    route: '/agent/chat',
    method: 'QUEUED',
    chatSpan,
  }
  const run = createAgentRun(conversation.userId, sessionId, chat.streamId, runTrace)

  logEvent('info', 'agent.chat.queued_turn_start', {
    request_id: requestId,
    user_id: actorUserId,
    session_id: sessionId,
    stream_id: chat.streamId,
    message_id: item.id,
    waited_ms: Date.now() - Date.parse(item.receivedAt),
  })
  acceptAgentRun(run, messages)
  launchAcceptedChatTurn({
    run,
    chatCtx,
    chatSpan,
    body,
    teamId,
    messages,
    firstMessage: getFirstUserMessage(messages),
    locale: chat.locale,
    credentialAccess: chat.credentialAccess,
    credentialAccessRequested: Boolean(chat.credentialAccess),
    releaseClaim,
    slack: null,
    chatRuntime,
    queued: item,
  })
}
