// Starts a session's next turn from its queue, in arrival order.

import { wakeOfflineBox } from '@/lib/agent/devices/box-wake'
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
} from './session-released'
import { openSignInRequest, releaseWhenAskLapses } from './sign-in-request'
import { turnRunner } from './turn-runner'

import type { AgentConversation } from './db'
import type { PendingUserMessage } from './pending-message-types'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'

const runtimeAccepts = (state: SessionExecutionState) =>
  state.schemaVersion !== 2 || state.actions?.send === true

/** Whether this conversation may run its queue now; schedules a retry when it should wait. */
async function ready(userId: string, sessionId: string, target: AgentConversation | null) {
  // The holder runs this again when it lets go.
  if (await turnRunner.hasActiveAgentRunForSession(userId, sessionId)) return false
  // Runtime-owned work (an automatic continuation) holds no backend claim.
  if (target?.claudeCodePreview && !runtimeAccepts(await conversationExecutionState(target))) {
    retryQueuedTurn(userId, sessionId)

    return false
  }

  return true
}

/**
 * Starts the next turn from the session queue. Called whenever the session is
 * released, so whatever arrived first, a person's message or an agent's, runs
 * next, and a message accepted for a turn that ended without reading it does
 * not wait for one that may never come.
 */
export async function startQueuedTurn(userId: string, sessionId: string): Promise<void> {
  const target = await getConversationBySessionId(sessionId)

  if (!(await ready(userId, sessionId, target))) return
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

    // A send never waits for a Box: the queue does, while it resumes in the background.
    if (queue.length > 0 && (await wakeOfflineBox(target?.runtimeId))) {
      retryQueuedTurn(userId, sessionId)

      return
    }
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

/**
 * A send that failed to start waits for another try when the failure can pass:
 * a busy runtime, an approval still to come, or a server error. Anything else
 * (an agent that is gone or signed out, a declined computer) never will, so
 * its sender is told instead of the queue being held behind it.
 */
const mayStartLater = (error: unknown) =>
  !(error instanceof AppError) ||
  error.status >= 500 ||
  error.status === 409 ||
  error.code === 'local_share_approval_required'

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
    if (mayStartLater(error)) await requeueTurnQueue(target.userId, target.sessionId, [], item)
    else
      await reportUndelivered(
        { userId: target.userId, teamId: target.teamId, targetSessionId: target.sessionId },
        [item],
        `was not sent: ${error instanceof Error ? error.message : 'its agent cannot run it.'}`,
      )

    return false
  }
}
