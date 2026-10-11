import { discordAgentThreads } from '@/lib/discord/store'
import { slackAgentThreads } from '@/lib/slack/agent-bot/collections'

import type { AgentConversation } from './db'
import type { DiscordAgentThread } from '@/lib/discord/store'
import type { SlackAgentThread } from '@/lib/slack/agent-bot/collections'

/**
 * A Slack or Discord thread bound to a session. These are not stored on the
 * conversation: the thread routing rows (unique by sessionId) already are the
 * binding, so the tag is read from them and disappears with them.
 */
export type SessionThreadResource = {
  id: string
  provider: 'slack' | 'discord'
  title: string
  url: string
  state: 'linked'
  linkedAt: string
}

type SlackThreadRef = Pick<
  SlackAgentThread,
  'sessionId' | 'slackWorkspaceId' | 'slackChannelId' | 'slackThreadTs' | 'createdAt'
>
type DiscordThreadRef = Pick<
  DiscordAgentThread,
  'sessionId' | 'guildId' | 'threadChannelId' | 'createdAt'
>

export function slackThreadFallbackUrl(workspaceId: string, channelId: string, threadTs: string) {
  return `https://app.slack.com/client/${encodeURIComponent(workspaceId)}/${encodeURIComponent(channelId)}/thread/${encodeURIComponent(channelId)}-${encodeURIComponent(threadTs)}`
}

function slackResource(thread: SlackThreadRef): SessionThreadResource {
  return {
    id: `slack:${thread.slackChannelId}:${thread.slackThreadTs}`,
    provider: 'slack',
    title: 'Slack thread',
    url: slackThreadFallbackUrl(
      thread.slackWorkspaceId,
      thread.slackChannelId,
      thread.slackThreadTs,
    ),
    state: 'linked',
    linkedAt: thread.createdAt.toISOString(),
  }
}

function discordResource(thread: DiscordThreadRef): SessionThreadResource {
  return {
    id: `discord:${thread.threadChannelId}`,
    provider: 'discord',
    title: 'Discord thread',
    url: `https://discord.com/channels/${thread.guildId}/${thread.threadChannelId}`,
    state: 'linked',
    linkedAt: thread.createdAt.toISOString(),
  }
}

/** Thread tags for a page of sessions: one `$in` query per provider. */
export async function sessionThreadResources(
  sessionIds: readonly string[],
): Promise<Map<string, SessionThreadResource[]>> {
  const byId = new Map<string, SessionThreadResource[]>()

  if (!sessionIds.length) return byId
  const filter = { sessionId: { $in: [...new Set(sessionIds)] } }
  const [slack, discord] = await Promise.all([
    slackAgentThreads()
      .find<SlackThreadRef>(filter, {
        projection: {
          _id: 0,
          sessionId: 1,
          slackWorkspaceId: 1,
          slackChannelId: 1,
          slackThreadTs: 1,
          createdAt: 1,
        },
      })
      .toArray(),
    discordAgentThreads()
      .find<DiscordThreadRef>(filter, {
        projection: { _id: 0, sessionId: 1, guildId: 1, threadChannelId: 1, createdAt: 1 },
      })
      .toArray(),
  ])

  const add = (sessionId: string, resource: SessionThreadResource) =>
    byId.set(sessionId, [...(byId.get(sessionId) ?? []), resource])

  for (const thread of slack) add(thread.sessionId, slackResource(thread))
  for (const thread of discord) add(thread.sessionId, discordResource(thread))

  return byId
}

/** Stored GitHub/Linear links followed by the session's thread tags. */
export async function sessionResources(conversation: AgentConversation) {
  const threads = await sessionThreadResources([conversation.sessionId])

  return [...(conversation.linkedResources ?? []), ...(threads.get(conversation.sessionId) ?? [])]
}
