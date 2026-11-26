import type { AgentConversation } from './db'
import type { MessageMetadata } from './message-metadata'

/** An agent's channel post where the channel's people are in Slack: a Slack message. */
export async function slackPost(
  channel: AgentConversation,
  agent: Pick<AgentConversation, 'title'>,
  text: string,
  files: object[],
  quote: MessageMetadata['replyTo'],
) {
  if (files.length > 0) throw new Error('Files cannot be posted to a Slack channel yet.')
  // Lazy so importing this does not pull in the Slack client.
  const { postToSlack } = await import('@/lib/slack/external-chat-post')

  return await postToSlack(channel, agent, text, quote)
}
