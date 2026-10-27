// A send to a teammate's shared computer waits in the session queue for its owner's answer.
import {
  getConversationBySessionId,
  stampConversationRuntimeInstance,
  upsertConversationShell,
} from '@/lib/agent/db'
import { listPendingUserMessages, takePendingUserMessages } from '@/lib/agent/pending-queue'
import { sessionReleased } from '@/lib/agent/session-released'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

import { queueForOfflineBox } from './session-queue-offline'
import { admitQueueableChat, messageText } from './session-queue-turn'

import type { QueueableChat } from './session-queue-turn'
import type { ShareApproval } from '@/lib/agent/devices/local-share-store'

/** What the sender is told while the message waits. */
export type ShareApprovalWait = { waiting: 'share_approval'; message: string }
/** A send the queue holds: for an offline Box (null), or for an owner's approval. */
export type QueuedSend = ShareApprovalWait | null

export function isQueued<T extends object>(runtime: T | QueuedSend): runtime is QueuedSend {
  return runtime === null || 'waiting' in runtime
}

export function queuedReply(streamId: string, wait: QueuedSend) {
  return { status: 'queued' as const, streamId, ...(wait ? { message: wait.message } : {}) }
}

/** A send as the chat route holds it: the conversation may not be stored yet. */
type WaitingChat = Omit<QueueableChat, 'snapshot' | 'runtimeOffline'> & {
  sessionId: string
  teamId?: string
}

/** A send whose runtime cannot take it yet waits in the queue; anything else is rethrown. */
export function queueForWaitingRuntime(error: unknown, args: WaitingChat): Promise<QueuedSend> {
  return queueForOfflineBox(error, args).catch((refused: unknown) =>
    queueForShareApproval(refused, args),
  )
}

function approvalPlacement(error: unknown): { runtimeId: string; message: string } | null {
  if (!(error instanceof AppError) || error.code !== 'local_share_approval_required') return null
  const details = error.details as { runtimeId?: unknown } | undefined

  return typeof details?.runtimeId === 'string'
    ? { runtimeId: details.runtimeId, message: error.message }
    : null
}

/**
 * A send that needs the owner's approval waits in the queue, which starts it
 * once they approve (routes-devices-share). Anything else is rethrown, as is
 * a send the queue cannot hold (an older client, or no stored conversation yet).
 */
export async function queueForShareApproval(
  error: unknown,
  args: WaitingChat,
): Promise<ShareApprovalWait> {
  const placement = approvalPlacement(error)

  if (!placement) throw error
  // A new chat's first send is the usual one: it is stored here, on the computer it asked for.
  const conversation = args.conversation ?? (await startConversation(args, placement.runtimeId))

  if (!conversation) throw error
  // The queue starts the turn from the conversation's placement: keep the one chosen here.
  if (!conversation.runtimeId)
    await stampConversationRuntimeInstance(conversation.sessionId, placement.runtimeId)
  const queued = await admitQueueableChat({
    ...args,
    conversation,
    snapshot: undefined,
    runtimeOffline: true,
  })

  if (queued?.mode !== 'queued') throw error

  return {
    waiting: 'share_approval',
    message:
      'Waiting for the owner of this computer to approve. Your message is sent once they do.',
  }
}

/** Stores a new chat whose first send waits for the owner, placed on their computer. */
async function startConversation(args: WaitingChat, runtimeId: string) {
  const message = args.clientView.at(-1)

  if (!args.teamId || message?.role !== 'user') return null
  await upsertConversationShell({
    sessionId: args.sessionId,
    userId: args.runOwnerUserId,
    teamId: args.teamId,
    title: '',
    firstMessage: messageText(message),
    locale: args.context.locale,
    source: 'app',
    runtimeId,
  })

  return getConversationBySessionId(args.sessionId)
}

/**
 * The owner answered: an approval starts what waited, a refusal drops the
 * requester's waiting sends, so a later one is told it was declined.
 */
export async function settleShareApprovalQueue(approval: ShareApproval): Promise<void> {
  const conversation = await getConversationBySessionId(approval.sessionId)

  if (!conversation) return
  const { userId, sessionId } = conversation

  if (approval.status === 'approved') {
    sessionReleased(userId, sessionId)

    return
  }
  if (approval.status !== 'denied') return
  const waiting = (await listPendingUserMessages(userId, sessionId)).filter(
    (message) => message.chat && (message.actorUserId ?? userId) === approval.actorId,
  )
  const dropped = await takePendingUserMessages(userId, sessionId, waiting)

  if (dropped.length)
    logEvent('info', 'agent.pending_messages.share_declined_dropped', {
      user_id: userId,
      session_id: sessionId,
      message_ids: dropped.map((message) => message.id),
    })
}
