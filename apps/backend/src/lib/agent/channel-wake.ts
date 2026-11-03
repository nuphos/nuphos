import { CHANNEL_SENDER_PREFIX, readChannelMessages } from './db/channels'
import { agentConversations } from './db/shared'

import type { MessageMetadata } from './message-metadata'

/** A channel's wake notice as queued: fixed per channel, so the queue keeps one. */
export const channelNotice = (channelId: string) =>
  `New messages in a Nuphos channel (channelId ${channelId}).`

/**
 * Puts what a channel notice is about into it: the posts the agent has not read,
 * read now that its turn starts, so it answers what was said rather than relying
 * on it to call channel_read. A notice that already carries posts keeps them,
 * should its turn be refused and requeued, and gains any posted since. One with
 * nothing to show (the agent caught up during the turn it waited behind) is dropped.
 */
export async function withChannelPosts<
  M extends { source?: string; metadata?: MessageMetadata; renderedText: string },
>(agentSessionId: string, messages: M[]): Promise<M[]> {
  const kept: M[] = []

  for (const message of messages) {
    const id = message.metadata?.sender?.id

    if (message.source !== 'agent.resource' || !id?.startsWith(CHANNEL_SENDER_PREFIX)) {
      kept.push(message)
      continue
    }
    const channelId = id.slice(CHANNEL_SENDER_PREFIX.length)
    const channel = await agentConversations().findOne({ sessionId: channelId })
    const page = channel && (await readChannelMessages(channel, agentSessionId, true))
    const carries = message.renderedText !== channelNotice(channelId)

    if (!page?.messages.length) {
      if (carries || !channel) kept.push(message)
      continue
    }
    kept.push({ ...message, renderedText: `${message.renderedText}\n\n${channelPage(page)}` })
  }

  return kept
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
