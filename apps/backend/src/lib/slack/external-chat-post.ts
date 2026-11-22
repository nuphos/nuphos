import { agentMessages } from '@/lib/agent/db'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import { AppError } from '@/lib/errors'
import { getSlackChannelMappingByExternalChat } from '@/lib/slack/agent-bot'
import { postSlackMessage } from '@/lib/slack/api'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { escapeSlackMrkdwn } from '@/lib/slack/mrkdwn'
import { toSlackMrkdwn } from '@/lib/slack/mrkdwn/convert'

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
  bot: { title?: string },
  text: string,
  replyTo: MessageMetadata['replyTo'],
): Promise<string> {
  const mapping = await getSlackChannelMappingByExternalChat(record.sessionId)
  const installed = mapping && (await resolveSlackBotForWorkspace(mapping.slackWorkspaceId))

  if (!mapping || !installed)
    throw new AppError(409, 'slack_channel_unavailable', 'This chat is no longer in Slack.')
  const name = bot.title || 'Nuphos'
  const body = toSlackMrkdwn(text)
  const threadTs = await threadRoot(record, mapping.slackChannelId, replyTo?.id)
  const post = (customize: boolean) =>
    postSlackMessage({
      token: installed.botToken,
      channel: mapping.slackChannelId,
      // Without the name Slack shows the app's, so the post opens with the Bot's.
      text: customize ? body : `*${escapeSlackMrkdwn(name)}*\n${body}`,
      threadTs,
      ...(customize ? { username: name } : {}),
    })
  // Slack does not say a custom name is ignored without chat:write.customize,
  // so a token that refuses it posts once more without one.
  const customize = installed.binding.scope.split(',').includes('chat:write.customize')
  const { ts } = await post(customize).catch(async (error: unknown) => {
    if (!customize || !(error instanceof AppError) || error.message !== 'missing_scope') throw error

    return await post(false)
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
