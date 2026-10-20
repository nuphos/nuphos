// Starts a session's next turn from its queue, in arrival order.
import { wakeOfflineBox } from '@/lib/agent/devices/box-wake'
import { conversationExecutionState } from '@/lib/claude-code-preview/session-execution-state'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

import { reportUndelivered, runTurn } from './conversation-turn'
import { getConversationBySessionId } from './db'
import { canReply, conversationAccess } from './db/access'
import { PENDING_TTL_SEC } from './pending-messages'
import { listPendingUserMessages, queueHead, takePendingUserMessages } from './pending-queue'
import { queuedTurnSettled, requeueTurnQueue, retryQueuedTurn } from './session-released'
import { turnRunner } from './turn-runner'

import type { AgentConversation } from './db'
import type { PendingUserMessage } from './pending-message-types'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'

/**
 * A message that has waited this long, or failed this often, is dropped and its
 * sender told. A minute inside the queue's TTL, so the sweep drops it before Redis does.
 */
const MAX_QUEUED_MS = (PENDING_TTL_SEC - 60) * 1000
const MAX_ATTEMPTS = 5

const runtimeAccepts = (state: SessionExecutionState) =>
  state.schemaVersion !== 2 || state.actions?.send === true

const DROPPED = {
  expired: 'was dropped after waiting an hour in its queue without running.',
  too_many_attempts: 'was dropped after its runtime refused it five times.',
}

function stale(message: PendingUserMessage, now: number): keyof typeof DROPPED | null {
  if ((message.attempts ?? 0) >= MAX_ATTEMPTS) return 'too_many_attempts'

  return now - Date.parse(message.receivedAt) > MAX_QUEUED_MS ? 'expired' : null
}

async function dropStale(userId: string, sessionId: string, target: AgentConversation | null) {
  const now = Date.now()
  const dropped = (await listPendingUserMessages(userId, sessionId)).flatMap((message) => {
    const reason = stale(message, now)

    return reason ? [{ message, reason }] : []
  })
  const taken = await takePendingUserMessages(
    userId,
    sessionId,
    dropped.map((entry) => entry.message),
  )

  for (const { message, reason } of dropped) {
    // Another replica's sweep took it first, and reports it.
    if (!taken.includes(message)) continue
    logEvent('warn', 'agent.pending_messages.queued_dropped', {
      user_id: userId,
      session_id: sessionId,
      message_id: message.id,
      source: message.source,
      reason,
      attempts: message.attempts ?? 0,
    })
    await reportUndelivered(
      { userId, teamId: target?.teamId, targetSessionId: sessionId },
      [message],
      DROPPED[reason],
    )
  }
}

/** Whether this conversation may run its queue now; schedules a retry when it should wait. */
async function ready(userId: string, sessionId: string, target: AgentConversation | null) {
  // The holder runs this again when it lets go.
  if (await turnRunner.hasActiveAgentRunForSession(userId, sessionId)) return false
  // An archived conversation stops polling; the send that restores it starts the queue.
  if (target?.archivedAt) return false
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

  // Ahead of the gate: a queue that never gets to run still answers its senders.
  await dropStale(userId, sessionId, target)
  if (!(await ready(userId, sessionId, target))) return
  const release = await turnRunner.claimAgentRunForSession(userId, sessionId)

  if (!release) return
  let handedOff = false

  try {
    const queue = await listPendingUserMessages(userId, sessionId)

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

  if (!member || !canReply(conversationAccess(target, actorUserId))) {
    logEvent('warn', 'agent.pending_messages.queued_dropped', { ...fields, reason: 'no_access' })

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
    await requeueTurnQueue(target.userId, target.sessionId, [], item)

    return false
  }
}
