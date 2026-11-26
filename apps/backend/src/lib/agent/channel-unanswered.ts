import { randomUUID } from 'node:crypto'

import { logError } from '@/lib/observability'

import { noticeChannelId, unansweredNotice } from './db/channel-notes'
import { isChannel, postText } from './db/channels'
import { agentConversations, agentMessages } from './db/shared'
import { parseMessageMetadata, systemSender } from './message-metadata'
import { fenceUntrusted } from './untrusted-content'

import type { AgentConversation } from './db'
import type { MessageMetadata } from './message-metadata'
import type { PendingUserMessage } from './pending-messages'

/** startConversationTurn, passed in so this module does not import the turn that calls it. */
type StartTurn = (
  data: {
    userId: string
    teamId: string
    targetSessionId: string
    messageId: string
    locale: string
  },
  target: AgentConversation,
  renderedText: string,
  source: 'agent.resource',
  metadata: MessageMetadata,
) => Promise<{ run: Promise<unknown> }>

/**
 * A Bot speaks in a chat only with channel_post, so a turn a person's post or
 * answer woke can end with the reply only in its own transcript (#5162). When
 * such a turn ends normally, each chat that woke it and is the Bot's to answer
 * (its 1:1 chat, or a group it leads), whose newest post is still that
 * person's, gets one more turn: a Nuphos notice carrying the post. That notice
 * is no chat's wake, so it never leads to another; `agentRemindedIndex` keeps
 * it to one per post when the same post woke several turns.
 */
export async function remindUnanswered(
  agent: AgentConversation,
  woke: readonly Pick<PendingUserMessage, 'source' | 'metadata' | 'answers'>[],
  finishReason: string | undefined,
  start: StartTurn,
): Promise<void> {
  if (finishReason !== 'stop') return
  const { sessionId } = agent

  for (const channelId of new Set(woke.flatMap((m) => wokenBy(m) ?? m.answers?.channelId ?? [])))
    await remindOne(agent, channelId, start).catch((error: unknown) => {
      logError('agent.channel.remind_failed', error, {
        channel_id: channelId,
        session_id: sessionId,
      })
    })
}

/** channelIdOf: channel-wake re-exports this module, so this cannot import it from there. */
const wokenBy = (m: Pick<PendingUserMessage, 'source' | 'metadata'>) =>
  m.source === 'agent.resource' ? noticeChannelId(m.metadata?.sender?.id) : undefined

async function remindOne(agent: AgentConversation, channelId: string, start: StartTurn) {
  const { sessionId } = agent
  const channel = await agentConversations().findOne({ sessionId: channelId })

  if (!channel?.teamId || !isChannel(channel)) return
  if (channel.agentSessionIds?.length !== 1 && channel.leadAgentSessionId !== sessionId) return
  const newest = await agentMessages().findOne({
    sessionId: channelId,
    userId: channel.userId,
    index: channel.messageCount - 1,
  })
  const metadata = parseMessageMetadata(newest?.metadata)

  // The Bot's own post is newest once it answered.
  if (!newest || metadata?.sender.type !== 'user') return
  // A post it has not been shown has its own wake coming. An answer to its card it was given.
  if (!metadata.requestId && (channel.agentReadIndex?.[sessionId] ?? -1) < newest.index) return
  const reminded = `agentRemindedIndex.${sessionId}`
  const claimed = await agentConversations().updateOne(
    {
      sessionId: channelId,
      $or: [{ [reminded]: { $exists: false } }, { [reminded]: { $lt: newest.index } }],
    },
    { $set: { [reminded]: newest.index } },
  )

  if (claimed.modifiedCount === 0) return
  const post = fenceUntrusted(
    'channel-message',
    `${metadata.sender.displayName}: ${postText(newest.parts)}`,
    '',
  ).trimEnd()
  // Queued behind the turn that just ended.
  const { run } = await start(
    {
      userId: agent.userId,
      teamId: channel.teamId,
      targetSessionId: sessionId,
      messageId: randomUUID(),
      locale: agent.metadata?.locale ?? 'en-US',
    },
    agent,
    `${unansweredNotice(channel)}\n\n${post}`,
    'agent.resource',
    systemSender('nuphos', 'Nuphos', `/teams/${channel.teamId}/agent/${channelId}`),
  )

  run.catch((error: unknown) => {
    logError('agent.channel.remind_failed', error, { channel_id: channelId, session_id: sessionId })
  })
}
