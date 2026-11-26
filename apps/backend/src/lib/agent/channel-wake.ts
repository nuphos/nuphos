import { randomUUID } from 'node:crypto'

import { logError } from '@/lib/observability'

import { markChannelRead, unmarkChannelRead } from './db/channel-cursor'
import { newestPost } from './channel-newest-post'
import {
  CHANNEL_SENDER_PREFIX,
  channelNotice,
  noticeChannelId,
  SLACK_CHANNEL_SENDER_PREFIX,
  unansweredNotice,
} from './db/channel-notes'
import { isChannel, readChannelMessages } from './db/channels'
import { agentConversations, agentMessages } from './db/shared'
import {
  listPendingUserMessages,
  requeuePendingAtHead,
  takePendingUserMessages,
} from './pending-queue'

import type { AgentConversation } from './db'
import { parseMessageMetadata, systemSender } from './message-metadata'

import type { MessageMetadata } from './message-metadata'

/** Who a channel's wake notice is from: the channel, never a person. */
export const channelNoticeSender = (
  teamId: string,
  channel: Pick<AgentConversation, 'sessionId' | 'external'>,
  displayName: string,
): MessageMetadata =>
  channel.external === 'slack'
    ? systemSender(`${SLACK_CHANNEL_SENDER_PREFIX}${channel.sessionId}`, displayName)
    : systemSender(
        `${CHANNEL_SENDER_PREFIX}${channel.sessionId}`,
        displayName,
        `/teams/${teamId}/agent/${channel.sessionId}`,
      )

/**
 * Steers the agent's running turn with the notice and the posts it has not
 * read, through the composer's steer. Only a turn its owner runs takes it, as
 * the composer lets only a turn's actor steer. False when there is no such
 * turn or the runtime cannot take it: the notice then queues.
 */
export async function steerRunningTurn(
  agent: AgentConversation,
  channel: Pick<AgentConversation, 'sessionId' | 'external'>,
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
  const notice = { source: 'agent.resource', metadata, renderedText: channelNotice(channel) }
  const { messages, markRead } = await withChannelPosts(agent.sessionId, agent.userId, [notice])

  // Already read, during the very turn it would steer.
  if (!messages[0]) return true
  try {
    await steerConversationRuntime(
      agent,
      { text: messages[0].renderedText, userId: agent.userId, metadata: messages[0].metadata },
      randomUUID(),
    )
  } catch {
    return false
  }
  // The turn now answers this channel too, so the channel shows it typing.
  await addRunChannels(agent.userId, active.streamId, [channel.sessionId])
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
 * runs, the queue starts it as its own turn: on that turn's release, or on the
 * backstop sweep if the turn ended while the notice was off the queue. A give-up
 * here is no release, so a queue waiting out a refusal keeps waiting (#4164).
 */
export function steerQueuedNotice(
  agent: AgentConversation,
  channel: Pick<AgentConversation, 'sessionId' | 'external'>,
  metadata: MessageMetadata,
  noticeId: string,
) {
  // The notice stays queued, so a failure here only leaves it to the turn's end.
  retrySteer(agent, channel, metadata, noticeId).catch((error: unknown) => {
    logError('agent.channel.steer_failed', error, {
      channel_id: channel.sessionId,
      session_id: agent.sessionId,
    })
  })
}

async function retrySteer(
  agent: AgentConversation,
  channel: Pick<AgentConversation, 'sessionId' | 'external'>,
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
    if (await steerRunningTurn(agent, channel, metadata)) return
    await requeuePendingAtHead(userId, sessionId, [notice])
  }
}

/** The channel a message is the wake notice of, if it is one. */
export const channelIdOf = (message: { source?: string; metadata?: MessageMetadata }) =>
  message.source === 'agent.resource' ? noticeChannelId(message.metadata?.sender?.id) : undefined

/**
 * Puts what a channel notice is about into it: the posts the agent has not read,
 * so it answers what was said rather than relying on it to call channel_read.
 * Nothing is marked read until `markRead`, as the turn is handed over, so
 * channel_read in that turn goes on from the posts it was shown. A refused or
 * failed turn takes that back, and delivers the same posts again. A notice with nothing to show (the agent caught up during the
 * turn it waited behind) is dropped.
 */
export async function withChannelPosts<
  M extends { source?: string; metadata?: MessageMetadata; renderedText: string },
>(agentSessionId: string, ownerId: string, messages: M[]) {
  const kept: M[] = []
  // Each channel's place before the notice, and the place it was shown up to.
  const read: [string, number | undefined, number][] = []

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
    if (page.upTo !== undefined)
      read.push([channelId, channel.agentReadIndex?.[agentSessionId], page.upTo])
    const channelPost = message.metadata && (await newestPost(channel, page))

    kept.push({
      ...message,
      // What people see of it: the newest post, as the agent got it.
      ...(channelPost ? { metadata: { ...message.metadata!, channelPost } } : {}),
      // From the bare notice, so a requeued one does not carry its posts twice.
      renderedText: `${noticeLead(channel, message.renderedText)}\n\n${channelPage(page)}`,
    })
  }

  return {
    messages: kept,
    /** Marks the posts read; what it returns takes that back. */
    markRead: async () => {
      for (const [channelId, , upTo] of read) await markChannelRead(channelId, agentSessionId, upTo)

      return async () => {
        for (const [channelId, from, upTo] of read)
          await unmarkChannelRead(channelId, agentSessionId, from, upTo)
      }
    },
  }
}

/**
 * An agent's turn chats woke ended normally (#5162). Where a chat is its to
 * answer (its 1:1 chat, or a group it leads) and the newest post there is a
 * person's it was shown and never answered, that post goes back to unread and
 * the agent is woken once more, told to answer with channel_post. Once per post,
 * so a turn that stays silent again is not woken a third time.
 */
export async function remindUnanswered(
  agent: AgentConversation,
  notices: readonly { source?: string; metadata?: MessageMetadata }[],
  finishReason: string | undefined,
): Promise<void> {
  if (finishReason !== 'stop') return
  const { sessionId } = agent
  const seen = new Set<string>()

  try {
    for (const notice of notices) {
      const channelId = channelIdOf(notice)

      if (!channelId || !notice.metadata || seen.has(channelId)) continue
      seen.add(channelId)
      const channel = await agentConversations().findOne({ sessionId: channelId })

      if (!channel?.teamId || !isChannel(channel)) continue
      if (channel.agentSessionIds?.length !== 1 && channel.leadAgentSessionId !== sessionId)
        continue
      const newest = await agentMessages().findOne({
        sessionId: channelId,
        userId: channel.userId,
        index: channel.messageCount - 1,
      })
      const sender = parseMessageMetadata(newest?.metadata)

      // An answer to a question card is the asker's already, never news (see readChannelMessages).
      if (!newest || sender?.sender.type !== 'user' || sender.requestId) continue
      const read = `agentReadIndex.${sessionId}`
      const reminded = `agentRemindedIndex.${sessionId}`
      // Shown to it (an unread post has its own wake coming) and not yet reminded of.
      const claimed = await agentConversations().updateOne(
        {
          sessionId: channelId,
          [read]: { $gte: newest.index },
          $or: [{ [reminded]: { $exists: false } }, { [reminded]: { $lt: newest.index } }],
        },
        { $set: { [read]: newest.index - 1, [reminded]: newest.index } },
      )

      if (claimed.modifiedCount === 0) continue
      // Lazy, as the turn imports this. Queued behind the turn that just ended.
      const { startConversationTurn } = await import('./conversation-turn')
      const { run } = await startConversationTurn(
        {
          userId: agent.userId,
          teamId: channel.teamId,
          targetSessionId: sessionId,
          messageId: randomUUID(),
          locale: agent.metadata?.locale ?? 'en-US',
        },
        agent,
        unansweredNotice(channel),
        'agent.resource',
        notice.metadata,
      )

      run.catch(failed(sessionId))
    }
  } catch (error) {
    failed(sessionId)(error)
  }
}

const failed = (sessionId: string) => (error: unknown) => {
  logError('agent.channel.remind_failed', error, { session_id: sessionId })
}

/** A notice's own words, without the posts it was last shown with. */
const noticeLead = (channel: Pick<AgentConversation, 'sessionId' | 'external'>, text: string) =>
  text.startsWith(unansweredNotice(channel)) ? unansweredNotice(channel) : channelNotice(channel)

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
