import { CHANNEL_SENDER_PREFIX, markChannelRead, readChannelMessages } from './db/channels'
import { agentConversations } from './db/shared'

import type { MessageMetadata } from './message-metadata'

/** A channel's wake notice as queued: fixed per channel, so the queue keeps one. */
export const channelNotice = (channelId: string) =>
  `New messages in a Nuphos channel (channelId ${channelId}).`

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
    const id = message.metadata?.sender?.id

    if (message.source !== 'agent.resource' || !id?.startsWith(CHANNEL_SENDER_PREFIX)) {
      kept.push(message)
      continue
    }
    const channelId = id.slice(CHANNEL_SENDER_PREFIX.length)
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
