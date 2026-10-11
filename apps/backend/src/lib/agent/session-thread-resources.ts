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
  | 'sessionId'
  | 'slackWorkspaceId'
  | 'slackChannelId'
  | 'slackThreadTs'
  | 'recentMessages'
  | 'createdAt'
>
type DiscordThreadRef = Pick<
  DiscordAgentThread,
  'sessionId' | 'guildId' | 'threadChannelId' | 'createdAt'
>

type ThreadSession = Pick<AgentConversation, 'sessionId' | 'firstMessage'>

/** The first words of a thread: its root message, else the message that started the session. */
function threadTitle(provider: string, text: string | undefined) {
  return text?.replace(/\s+/g, ' ').trim().slice(0, 80) || `${provider} thread`
}

export function slackThreadFallbackUrl(workspaceId: string, channelId: string, threadTs: string) {
  return `https://app.slack.com/client/${encodeURIComponent(workspaceId)}/${encodeURIComponent(channelId)}/thread/${encodeURIComponent(channelId)}-${encodeURIComponent(threadTs)}`
}

function slackResource(thread: SlackThreadRef, firstMessage?: string): SessionThreadResource {
  // The rolling window keeps the root until the thread outgrows it.
  const root = thread.recentMessages?.[0]

  return {
    id: `slack:${thread.slackChannelId}:${thread.slackThreadTs}`,
    provider: 'slack',
    title: threadTitle('Slack', root?.ts === thread.slackThreadTs ? root.text : firstMessage),
    url: slackThreadFallbackUrl(
      thread.slackWorkspaceId,
      thread.slackChannelId,
      thread.slackThreadTs,
    ),
    state: 'linked',
    linkedAt: thread.createdAt.toISOString(),
  }
}

// Nuphos names the Discord threads it opens after the message that started the session.
function discordResource(thread: DiscordThreadRef, firstMessage?: string): SessionThreadResource {
  return {
    id: `discord:${thread.threadChannelId}`,
    provider: 'discord',
    title: threadTitle('Discord', firstMessage),
    url: `https://discord.com/channels/${thread.guildId}/${thread.threadChannelId}`,
    state: 'linked',
    linkedAt: thread.createdAt.toISOString(),
  }
}

/** Thread tags for a page of sessions: one `$in` query per provider. */
export async function sessionThreadResources(
  sessions: readonly ThreadSession[],
): Promise<Map<string, SessionThreadResource[]>> {
  const byId = new Map<string, SessionThreadResource[]>()

  if (!sessions.length) return byId
  const firstMessages = new Map(
    sessions.map((session) => [session.sessionId, session.firstMessage]),
  )
  const filter = { sessionId: { $in: [...firstMessages.keys()] } }
  const [slack, discord] = await Promise.all([
    slackAgentThreads()
      .find<SlackThreadRef>(filter, {
        projection: {
          _id: 0,
          sessionId: 1,
          slackWorkspaceId: 1,
          slackChannelId: 1,
          slackThreadTs: 1,
          recentMessages: { $slice: 1 },
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

  for (const thread of slack)
    add(thread.sessionId, slackResource(thread, firstMessages.get(thread.sessionId)))
  for (const thread of discord)
    add(thread.sessionId, discordResource(thread, firstMessages.get(thread.sessionId)))

  return byId
}

/** Stored GitHub/Linear links followed by the session's thread tags. */
export async function sessionResources(conversation: AgentConversation) {
  const threads = await sessionThreadResources([conversation])

  return [...(conversation.linkedResources ?? []), ...(threads.get(conversation.sessionId) ?? [])]
}
