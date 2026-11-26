// Starts a session's next turn from its queue, in arrival order.

import { wakeOfflineBox } from '@/lib/agent/devices/box-wake'
import { isRuntimeRefusal } from '@/lib/claude-code-preview/runtime-refusal'
import { conversationExecutionState } from '@/lib/claude-code-preview/session-execution-state'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

import { reportUndelivered, runTurn } from './conversation-turn'
import { getConversationBySessionId } from './db'
import { canReplyIn } from './devices/conversation-computer'
import { listPendingUserMessages, queueHead, takePendingUserMessages } from './pending-queue'
import {
  queuedTurnSettled,
  requeueTurnQueue,
  retryQueuedTurn,
  sessionReleased,
  waitingOutRefusal,
} from './session-released'
import { openSignInRequest, releaseWhenAskLapses } from './sign-in-request'
import { withinOfflineGrace } from './turn-offline'
import { turnRunner } from './turn-runner'

import type { AgentConversation } from './db'
import type { PendingUserMessage } from './pending-message-types'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'

const runtimeAccepts = (state: SessionExecutionState) =>
  state.schemaVersion !== 2 || state.actions?.send === true

/**
 * Whether this conversation may run its queue now; schedules a retry when it should wait.
 * `detached` when its runtime did not answer the status read: the same `disconnected`
 * state the chat route queues a new message on (routes-chat-post.ts, admitQueueableChat).
 * Keep the two in step.
 */
async function ready(userId: string, sessionId: string, target: AgentConversation | null) {
  // The holder runs this again when it lets go.
  if (await turnRunner.hasActiveAgentRunForSession(userId, sessionId)) return false
  if (!target?.claudeCodePreview) return { detached: false }
  const state = await conversationExecutionState(target)

  // Runtime-owned work (an automatic continuation) holds no backend claim.
  if (!runtimeAccepts(state)) {
    retryQueuedTurn(userId, sessionId)

    return false
  }

  return { detached: state.state === 'disconnected' }
}

/**
 * The runtime did not answer, so a turn started now would fail. Its head waits for the
 * runtime to reattach, as it does for an offline computer; after the same grace its
 * senders are told.
 */
async function holdForReattach(target: AgentConversation, head: PendingUserMessage[]) {
  const [first, ...rest] = head

  if (!first) return
  if (withinOfflineGrace(first)) {
    await requeueTurnQueue(target.userId, target.sessionId, rest, {
      ...first,
      offlineSince: first.offlineSince ?? new Date().toISOString(),
    })

    return
  }
  await reportUndelivered(
    { userId: target.userId, teamId: target.teamId, targetSessionId: target.sessionId },
    head,
    'was not sent: the computer running this agent did not reconnect.',
    new AppError(409, 'runtime_offline', 'The computer running this agent did not reconnect.'),
  )
}

/**
 * A send never waits for a Box: the queue does, while it resumes in the background. True
 * when the queue is to wait. A Box its team's plan will not start never comes back, so
 * what waits on it fails now, with the plan's reason, a head at a time: the retry that
 * follows meets the same refusal for whatever queued behind.
 */
async function waitForBox(
  userId: string,
  sessionId: string,
  target: AgentConversation | null,
  queue: PendingUserMessage[],
): Promise<boolean> {
  if (queue.length === 0) return false
  try {
    if (!(await wakeOfflineBox(target?.runtimeId))) return false
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'box_vcpu_limit') throw error
    const refused = await takePendingUserMessages(userId, sessionId, queueHead(queue, userId))

    await reportUndelivered(
      { userId, teamId: target?.teamId, targetSessionId: sessionId },
      refused,
      `did not run: ${error.message}`,
      error,
    )
  }
  retryQueuedTurn(userId, sessionId)

  return true
}

/**
 * Starts the next turn from the session queue. Called whenever the session is
 * released, so whatever arrived first, a person's message or an agent's, runs
 * next, and a message accepted for a turn that ended without reading it does
 * not wait for one that may never come.
 */
export async function startQueuedTurn(
  userId: string,
  sessionId: string,
  released = false,
): Promise<void> {
  // Before the claim, whose release would start the queue again.
  const waiting = queueHead(await listPendingUserMessages(userId, sessionId), userId)[0]

  if (waitingOutRefusal(waiting, released)) return
  const target = await getConversationBySessionId(sessionId)

  const runtime = await ready(userId, sessionId, target)

  if (!runtime) return
  const release = await turnRunner.claimAgentRunForSession(userId, sessionId)

  if (!release) return
  let handedOff = false

  try {
    const queue = await listPendingUserMessages(userId, sessionId)
    const next = queueHead(queue, userId)[0]

    // Someone was asked to sign its agent in: their sign-in starts it (sign-in-settle).
    const ask = next?.chat ? openSignInRequest(target) : null

    if (ask) {
      releaseWhenAskLapses(`${userId}:${sessionId}`, ask, () => {
        sessionReleased(userId, sessionId)
      })

      return
    }

    if (await waitForBox(userId, sessionId, target, queue)) return
    const head = await takePendingUserMessages(userId, sessionId, queueHead(queue, userId))
    const first = head[0]

    if (!first) {
      queuedTurnSettled(userId, sessionId)

      return
    }
    if (!target?.teamId) {
      logEvent('warn', 'agent.pending_messages.queued_turn_dropped', {
        user_id: userId,
        session_id: sessionId,
        message_ids: head.map((message) => message.id),
      })
      await reportUndelivered(
        { userId, targetSessionId: sessionId },
        head,
        'did not run: the thread no longer exists.',
      )

      return
    }
    if (runtime.detached) {
      await holdForReattach(target, head)

      return
    }
    if (first.chat) {
      handedOff = await launchChat(target, { ...first, chat: first.chat }, release)

      return
    }
    queuedTurnSettled(userId, sessionId)
    await runTurn(
      {
        userId,
        teamId: target.teamId,
        targetSessionId: sessionId,
        locale: target.metadata?.locale,
      },
      target,
      first.source,
      head,
    )
  } finally {
    if (!handedOff) release()
  }
}

// Timed out, too early, rate limited: each passes with time, however long it takes.
const RETRYABLE_STATUS = new Set([408, 425, 429])

/**
 * A send that failed to start waits for another try when the failure can pass:
 * a busy or rate-limited runtime. Anything else, other 409s included
 * (an agent that is disabled or signed out, a declined computer), never will, so
 * its sender is told instead of the queue being held behind it.
 */
const mayStartLater = (error: unknown) =>
  isRuntimeRefusal(error) || (error instanceof AppError && RETRYABLE_STATUS.has(error.status))

/**
 * A server error or an offline computer usually passes within moments. It is retried
 * only for the grace a reconnecting computer gets, as `runTurn` does; then the sender is told.
 */
const passesSoon = (error: unknown) =>
  !(error instanceof AppError) || error.status >= 500 || error.code === 'runtime_offline'

/** True once the turn holds the claim; a failure before that puts the message back. */
async function launchChat(
  target: AgentConversation,
  item: Parameters<typeof turnRunner.launchQueuedChatTurn>[1],
  release: () => void,
): Promise<boolean> {
  const actorUserId = item.actorUserId ?? target.userId
  const fields = { user_id: target.userId, session_id: target.sessionId, message_id: item.id }

  // Someone removed from the conversation or the team since sending no longer speaks in it.
  const member =
    actorUserId === target.userId ||
    (Boolean(target.teamId) && (await getTeamMembership(actorUserId, target.teamId ?? '')) !== null)

  if (!member || !(await canReplyIn(target, actorUserId))) {
    logEvent('warn', 'agent.pending_messages.queued_dropped', { ...fields, reason: 'no_access' })
    await reportUndelivered(
      { userId: target.userId, teamId: target.teamId, targetSessionId: target.sessionId },
      [item],
      'was not sent: its sender can no longer reply in this conversation or use its computer.',
    )

    return false
  }
  try {
    await turnRunner.launchQueuedChatTurn(target, item, release)
    queuedTurnSettled(target.userId, target.sessionId)

    return true
  } catch (error) {
    logEvent('error', 'agent.pending_messages.queued_launch_failed', {
      ...fields,
      error: error instanceof Error ? error.message : String(error),
    })
    const failing = passesSoon(error)

    if (failing ? withinOfflineGrace(item) : mayStartLater(error))
      await requeueTurnQueue(target.userId, target.sessionId, [], {
        ...item,
        // Only an unbroken run of such tries counts toward the grace.
        offlineSince: failing ? (item.offlineSince ?? new Date().toISOString()) : undefined,
      })
    else
      await reportUndelivered(
        { userId: target.userId, teamId: target.teamId, targetSessionId: target.sessionId },
        [item],
        // Only a 4xx AppError's message is written for people; any other stays in the log above.
        `was not sent: ${error instanceof AppError && error.status < 500 ? error.message : 'the server could not start it. Send it again.'}`,
      )

    return false
  }
}
