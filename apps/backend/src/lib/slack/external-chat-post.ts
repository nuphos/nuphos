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
 * channel: its people are in Slack. An answer to one message goes into that
 * message's thread; without one it is top-level. Throws when Slack refuses it,
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
  // Without the scope Slack shows the app's name, so the post opens with the Bot's.
  const customize = installed.binding.scope.split(',').includes('chat:write.customize')
  const body = toSlackMrkdwn(text)
  const { ts } = await postSlackMessage({
    token: installed.botToken,
    channel: mapping.slackChannelId,
    text: customize ? body : `*${escapeSlackMrkdwn(name)}*\n${body}`,
    threadTs: await threadRoot(record, mapping.slackChannelId, replyTo?.id),
    ...(customize ? { username: name } : {}),
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

  // Bounded like a thread chain any client would draw.
  for (let depth = 0; depth < 10; depth++) {
    const original = await agentMessages().findOne(
      { sessionId: record.sessionId, userId: record.userId, messageId: id },
      { projection: { metadata: 1 } },
    )
    const above: string | undefined = parseMessageMetadata(original?.metadata)?.replyTo?.id

    if (!above?.startsWith(prefix)) break
    id = above
  }

  return id.slice(prefix.length)
}
