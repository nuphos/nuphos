import { randomUUID } from 'node:crypto'

import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { getConversationBySessionId } from './db'
import { CHANNEL_SENDER_PREFIX, markChannelRead, readChannelMessages } from './db/channels'
import { pushTimelineEvent } from './db/participants'
import { agentConversations } from './db/shared'
import {
  listPendingUserMessages,
  requeuePendingAtHead,
  takePendingUserMessages,
} from './pending-queue'
import { sessionReleased } from './session-released'

import type { AgentConversation } from './db'
import type { MessageMetadata } from './message-metadata'

/** A channel's wake notice as queued: fixed per channel, so the queue keeps one. */
export const channelNotice = (channelId: string) =>
  `New messages in a Nuphos channel (channelId ${channelId}).`

/** Who a channel's wake notice is from: the channel, never a person. */
export const channelNoticeSender = (
  teamId: string,
  channelId: string,
  displayName: string,
): MessageMetadata => ({
  version: 1,
  sender: { type: 'system', id: `${CHANNEL_SENDER_PREFIX}${channelId}`, displayName },
  source: 'agent.resource',
  resourceUrl: `/teams/${teamId}/agent/${channelId}`,
  sentAt: new Date().toISOString(),
})

/**
 * Steers the agent's running turn with the notice and the posts it has not
 * read, through the composer's steer. Only a turn its owner runs takes it, as
 * the composer lets only a turn's actor steer. False when there is no such
 * turn or the runtime cannot take it: the notice then queues.
 */
export async function steerRunningTurn(
  agent: AgentConversation,
  channelId: string,
  metadata: MessageMetadata,
) {
  // Lazy so importing this does not pull in the runtime graph.
  const [{ addRunChannels, getActiveAgentRunForSession }, { steerConversationRuntime }] =
    await Promise.all([
      import('@/lib/agent/run-store'),
      import('@/lib/claude-code-preview/session-execution-state'),
    ])
  const active = await getActiveAgentRunForSession(agent.userId, agent.sessionId)

  if (!active || (active.actorUserId && active.actorUserId !== agent.userId)) return false
  const notice = { source: 'agent.resource', metadata, renderedText: channelNotice(channelId) }
  const { messages, markRead } = await withChannelPosts(agent.sessionId, agent.userId, [notice])

  // Already read, during the very turn it would steer.
  if (!messages[0]) return true
  try {
    await steerConversationRuntime(
      agent,
      { text: messages[0].renderedText, userId: agent.userId, metadata },
      randomUUID(),
    )
  } catch {
    return false
  }
  // The turn now answers this channel too, so the channel shows it typing.
  await addRunChannels(agent.userId, active.streamId, [channelId])
  await markRead()

  return true
}

/** How long a queued notice keeps trying to reach the turn it waits behind. */
export const QUEUED_NOTICE_STEER = { attempts: 15, delayMs: 2_000 }

/**
 * A person's post whose notice queued behind a turn that could not take a
 * steer yet (it was still starting) must not wait for that whole turn to end.
 * Like a waiting message the composer steers, the notice leaves the queue,
 * steers, and goes back to the front if the turn still refuses it. Once no turn
 * runs, the queue starts it as its own turn.
 */
export function steerQueuedNotice(
  agent: AgentConversation,
  channelId: string,
  metadata: MessageMetadata,
  noticeId: string,
) {
  // The notice stays queued, so a failure here only leaves it to the turn's end.
  retrySteer(agent, channelId, metadata, noticeId).catch((error: unknown) => {
    logError('agent.channel.steer_failed', error, {
      channel_id: channelId,
      session_id: agent.sessionId,
    })
  })
}

async function retrySteer(
  agent: AgentConversation,
  channelId: string,
  metadata: MessageMetadata,
  noticeId: string,
) {
  const { userId, sessionId } = agent

  for (let attempt = 0; attempt < QUEUED_NOTICE_STEER.attempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, QUEUED_NOTICE_STEER.delayMs))
    const waiting = (await listPendingUserMessages(userId, sessionId)).find(
      (message) => message.id === noticeId,
    )
    // A turn took it, or another attempt holds it.
    const [notice] = waiting ? await takePendingUserMessages(userId, sessionId, [waiting]) : []

    if (!notice) return
    if (await steerRunningTurn(agent, channelId, metadata)) return
    await requeuePendingAtHead(userId, sessionId, [notice])
    // The turn may have ended while the notice was off the queue.
    sessionReleased(userId, sessionId)
  }
}

/** The channel a message is the wake notice of, if it is one. */
export function channelIdOf(message: { source?: string; metadata?: MessageMetadata }) {
  const id = message.metadata?.sender?.id

  return message.source === 'agent.resource' && id?.startsWith(CHANNEL_SENDER_PREFIX)
    ? id.slice(CHANNEL_SENDER_PREFIX.length)
    : undefined
}

/**
 * Puts what a channel notice is about into it: the posts the agent has not read,
 * so it answers what was said rather than relying on it to call channel_read.
 * Nothing is marked read until `markRead`, once the turn ran, so a refused or
 * failed turn delivers the same posts again. A notice with nothing to show
 * (the agent caught up during the turn it waited behind) is dropped.
 */
export async function withChannelPosts<
  M extends { source?: string; metadata?: MessageMetadata; renderedText: string },
>(agentSessionId: string, ownerId: string, messages: M[]) {
  const kept: M[] = []
  const read: [string, number][] = []

  for (const message of messages) {
    const channelId = channelIdOf(message)

    if (!channelId) {
      kept.push(message)
      continue
    }
    const channel = await agentConversations().findOne({ sessionId: channelId })

    if (!channel) {
      kept.push(message)
      continue
    }
    const page = await readChannelMessages(channel, agentSessionId, ownerId, true)

    if (page.messages.length === 0) continue
    if (page.upTo !== undefined) read.push([channelId, page.upTo])
    // From the bare notice, so a requeued one does not carry its posts twice.
    kept.push({ ...message, renderedText: `${channelNotice(channelId)}\n\n${channelPage(page)}` })
  }

  return {
    messages: kept,
    markRead: async () => {
      for (const [channelId, index] of read) await markChannelRead(channelId, agentSessionId, index)
    },
  }
}

function channelPage(page: Awaited<ReturnType<typeof readChannelMessages>>): string {
  const files = page.messages.some((message) => message.uploads)

  return JSON.stringify(
    {
      ...page,
      messages: page.messages.map(({ uploads, ...message }) =>
        uploads ? { ...message, files: uploads.length } : message,
      ),
      note:
        page.note +
        (files
          ? ' Call channel_read to get the files posted with these messages on this runtime.'
          : '') +
        (page.more ? ' More was posted: call channel_read for the rest.' : ''),
    },
    null,
    2,
  )
}

/** An agent a post woke could not reply: the channel says so, not just the log. */
export async function noteReplyFailed(channelId: string, agentId: string, error: unknown) {
  const agent = await getConversationBySessionId(agentId).catch(() => null)

  await agentConversations()
    .updateOne(
      { sessionId: channelId },
      {
        $push: pushTimelineEvent({
          kind: 'agent_reply_failed',
          at: new Date(),
          actorId: 'system',
          agentName: agent?.title || 'Nuphos agent',
          ...(error instanceof AppError ? { reason: error.message } : {}),
        }),
      },
    )
    // The failure itself is already logged; a lost notice must not fail the post.
    .catch(() => undefined)
}
