import { CHANNEL_SENDER_PREFIX, readChannelMessages } from './db/channels'
import { agentConversations } from './db/shared'

import type { MessageMetadata } from './message-metadata'

/**
 * Puts what a channel notice is about into it: the posts the agent has not read,
 * read now that its turn starts, so it answers what was said rather than relying
 * on it to call channel_read. A notice with nothing left to read (the agent
 * caught up during the turn it waited behind) is dropped.
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
    const channel = await agentConversations().findOne({
      sessionId: id.slice(CHANNEL_SENDER_PREFIX.length),
    })
    const page = channel && (await readChannelMessages(channel, agentSessionId, true))

    if (channel && page?.messages.length === 0) continue
    kept.push(
      page
        ? { ...message, renderedText: `${message.renderedText}\n\n${channelPage(page)}` }
        : message,
    )
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
