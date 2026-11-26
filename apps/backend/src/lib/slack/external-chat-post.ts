import { agentMessages, getConversationBySessionId } from '@/lib/agent/db'
import { speakingBot } from '@/lib/agent/db/bot-membership'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import { AppError } from '@/lib/errors'
import { getSlackChannelMapping, getSlackChannelMappingByExternalChat } from '@/lib/slack/agent-bot'
import { postAgentSlackMessage } from '@/lib/slack/agent-message'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'

import type { AgentConversation } from '@/lib/agent/db'
import type { MessageMetadata } from '@/lib/agent/message-metadata'

/** A Slack message's id in the record: Slack's own, so a redelivery is the same post. */
export const slackPostId = (slackChannelId: string, ts: string) => `slack:${slackChannelId}:${ts}`

/**
 * A Bot's post in a Slack channel's external chat (#3702) is a message in that
 * channel: its people are in Slack. An answer stays at the level of the message
 * it answers. Throws when Slack refuses it,
 * so the Bot learns its words reached no one. Returns the post's id for the record.
 */
export async function postToSlack(
  record: Pick<AgentConversation, 'sessionId' | 'userId'>,
  bot: Pick<AgentConversation, 'sessionId'>,
  text: string,
  replyTo: MessageMetadata['replyTo'],
): Promise<string> {
  const mapping = await getSlackChannelMappingByExternalChat(record.sessionId)
  const installed = mapping && (await resolveSlackBotForWorkspace(mapping.slackWorkspaceId))

  if (!mapping || !installed)
    throw new AppError(409, 'slack_channel_unavailable', 'This chat is no longer in Slack.')
  const { ts } = await postAgentSlackMessage({
    token: installed.botToken,
    channel: mapping.slackChannelId,
    text,
    threadTs: await threadRoot(record, mapping.slackChannelId, replyTo?.id),
    from: { sessionId: bot.sessionId, slackWorkspaceId: mapping.slackWorkspaceId },
  })

  if (!ts) throw new AppError(502, 'slack_api_error', 'Slack returned no message id')

  return slackPostId(mapping.slackChannelId, ts)
}

/**
 * The Slack thread an answer to `messageId` belongs in: the ts of the message
 * that started it. A reply quotes the message it answers, so following the
 * quotes back from it ends at that message.
 */
async function threadRoot(
  record: Pick<AgentConversation, 'sessionId' | 'userId'>,
  slackChannelId: string,
  messageId: string | undefined,
): Promise<string | undefined> {
  const prefix = slackPostId(slackChannelId, '')

  if (!messageId?.startsWith(prefix)) return undefined
  let id: string = messageId
  let inThread: boolean | undefined

  // Bounded like a thread chain any client would draw.
  for (let depth = 0; depth < 10; depth++) {
    const original = await agentMessages().findOne(
      { sessionId: record.sessionId, userId: record.userId, messageId: id },
      { projection: { metadata: 1 } },
    )
    const metadata = parseMessageMetadata(original?.metadata)
    const above: string | undefined = metadata?.replyTo?.id

    // A Bot's own quote may itself be a top-level answer. The first human
    // message in the chain tells us whether the conversation is in a thread.
    if (inThread === undefined && metadata?.sender?.type === 'user' && metadata.slackThreadTs)
      return metadata.slackThreadTs
    if (inThread === undefined && metadata?.sender?.type === 'user')
      inThread = Boolean(above?.startsWith(prefix))

    if (!above?.startsWith(prefix)) break
    id = above
  }

  return inThread ? id.slice(prefix.length) : undefined
}

/**
 * A channel that is a Bot's chat (#3702) is that chat's people and Bots: an
 * agent posts there only as one of its Bots, itself or the Bot above its Task.
 */
export async function mayPostToSlackChannel(
  sessionId: string,
  slackWorkspaceId: string,
  slackChannelId: string,
): Promise<boolean> {
  const mapping = await getSlackChannelMapping(slackWorkspaceId, slackChannelId)

  if (!mapping?.externalChatId) return true
  const [chat, self] = await Promise.all([
    getConversationBySessionId(mapping.externalChatId),
    getConversationBySessionId(sessionId),
  ])
  const bot = self && (await speakingBot(self).catch(() => null))

  return Boolean(bot && chat?.agentSessionIds?.includes(bot.sessionId))
}
