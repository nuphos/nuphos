import type { PendingUserMessage } from '@/lib/agent/pending-messages'
import type { SlackRuntime } from '@/routes/slack/types'

import { createMessageMetadata } from '@/lib/agent/message-attribution'
import {
  buildPendingUserMessage,
  drainPendingUserMessages,
  hasPendingUserMessage,
  removePendingUserMessage,
} from '@/lib/agent/pending-messages'
import { turnRunner } from '@/lib/agent/turn-runner'
import { supersedePendingAgentPermissions } from '@/lib/claude-code-preview/decision-waiter'
import { logEvent } from '@/lib/observability'
import { capture } from '@/lib/posthog'
import { markSlackEvent } from '@/lib/slack/agent-bot'
import { addReactionSafe, postThreadMessage, RECEIPT_REACTION } from '@/routes/slack/shared'

const QUEUED_HANDOFF_POLL_MS = 500
const QUEUED_HANDOFF_TIMEOUT_MS = 50 * 60_000

type SlackTurnAdmissionArgs = {
  runtime: SlackRuntime
  userId: string
  sessionId: string
  channel: string
  threadTs: string
  eventId?: string
  renderedText: string
  actorUserId?: string
  reactionMessageTs?: string
}

async function supersedeBlockedPermission(
  args: SlackTurnAdmissionArgs,
  activeActorUserId?: string,
): Promise<void> {
  if (!activeActorUserId) return
  const superseded = await supersedePendingAgentPermissions({
    userId: activeActorUserId,
    sessionId: args.sessionId,
    supersededByUserId: args.actorUserId,
  })

  if (superseded === 0) return
  const properties = {
    session_id: args.sessionId,
    conversation_owner_user_id: args.userId,
    active_actor_user_id: activeActorUserId,
    incoming_actor_user_id: args.actorUserId,
    superseded_count: superseded,
    source: 'slack',
    metadata: args.actorUserId ? await createMessageMetadata(args.actorUserId, 'slack') : undefined,
  }

  logEvent('info', 'agent.permission.superseded_by_user_message', properties)
  capture('agent_permission_superseded_by_user_message', {
    distinctId: args.actorUserId ?? args.userId,
    properties,
  })
}

async function adoptQueuedMessage(
  args: SlackTurnAdmissionArgs,
  message: PendingUserMessage,
): Promise<{ release: () => void; carried: PendingUserMessage[] } | null> {
  const deadline = Date.now() + QUEUED_HANDOFF_TIMEOUT_MS

  while (await hasPendingUserMessage(args.userId, args.sessionId, message.id)) {
    const release = await turnRunner.claimAgentRunForSession(args.userId, args.sessionId)

    if (release) {
      if (!(await hasPendingUserMessage(args.userId, args.sessionId, message.id))) {
        release()
        continue
      }
      const carried = await drainPendingUserMessages(
        args.userId,
        args.sessionId,
        args.actorUserId ?? args.userId,
      )

      if (carried.some((entry) => entry.id === message.id)) {
        return { release, carried: carried.filter((entry) => entry.id !== message.id) }
      }
      release()
    }
    if (Date.now() >= deadline) {
      await removePendingUserMessage(args.userId, args.sessionId, message.id)
      await postThreadMessage(
        args.runtime,
        args.channel,
        args.threadTs,
        "I couldn't safely resume that message after the previous turn. Please send it again.",
      )
      if (args.eventId) await markSlackEvent(args.eventId, 'completed')

      return null
    }
    await new Promise((resolve) => setTimeout(resolve, QUEUED_HANDOFF_POLL_MS))
  }

  if (args.eventId) await markSlackEvent(args.eventId, 'completed')

  return null
}

/**
 * Either this event owns the turn, or its message is handed to the live turn.
 * An incoming message also supersedes a blocking OpenAB tool approval so the
 * conversation can reach its next safe prompt boundary without cancelling the
 * whole backend turn.
 */
export async function claimSlackTurnOrQueue(
  args: SlackTurnAdmissionArgs,
): Promise<{ release: () => void; carried: PendingUserMessage[] } | null> {
  const message = buildPendingUserMessage({
    renderedText: args.renderedText,
    source: 'slack',
    metadata: args.actorUserId ? await createMessageMetadata(args.actorUserId, 'slack') : undefined,
    actorUserId: args.actorUserId,
  })
  const outcome = await turnRunner.claimAgentRunOrEnqueue({
    userId: args.userId,
    sessionId: args.sessionId,
    message,
    actorUserId: args.actorUserId,
  })

  if (outcome.mode === 'run') {
    return {
      release: outcome.release,
      carried: outcome.carried.filter((entry) => entry.id !== message.id),
    }
  }
  if (outcome.mode === 'dropped') {
    await postThreadMessage(
      args.runtime,
      args.channel,
      args.threadTs,
      "I'm mid-way through the previous message and couldn't hold on to that one — send it again in a moment.",
    )
    if (args.eventId) await markSlackEvent(args.eventId, 'completed')

    return null
  }
  await supersedeBlockedPermission(args, outcome.activeActorUserId)
  if (args.reactionMessageTs) {
    await addReactionSafe(
      args.runtime.botToken,
      args.channel,
      args.reactionMessageTs,
      RECEIPT_REACTION,
    )
  }

  return adoptQueuedMessage(args, message)
}
