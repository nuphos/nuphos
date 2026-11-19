import { randomUUID } from 'node:crypto'

import { agentConversations } from '@/lib/agent/db'
import { setSlackChannelExternalChat } from '@/lib/slack/agent-bot'

import type { SlackChannelMapping } from '@/lib/slack/agent-bot'

/**
 * A connected channel's hidden record (#3702): what its Bots read and post
 * there. Made on first connect, and kept while the channel stays connected.
 * Nobody watches it and nobody else may read it, so no list, badge or Inbox
 * in Nuphos ever shows it.
 */
export async function ensureExternalChat(
  mapping: Pick<
    SlackChannelMapping,
    'slackWorkspaceId' | 'slackChannelId' | 'teamId' | 'externalChatId'
  >,
  userId: string,
  title: string,
): Promise<string> {
  const record = mapping.externalChatId
    ? await agentConversations().findOne(
        { sessionId: mapping.externalChatId, external: 'slack' },
        { projection: { _id: 0, sessionId: 1 } },
      )
    : null

  if (record) return record.sessionId
  const now = new Date()
  const sessionId = randomUUID()

  await agentConversations().insertOne({
    sessionId,
    userId,
    teamId: mapping.teamId,
    kind: 'channel',
    external: 'slack',
    generalAccess: 'none',
    title,
    firstMessage: '',
    messageCount: 0,
    agentSessionIds: [],
    createdAt: now,
    lastActiveAt: now,
  })
  const kept = await setSlackChannelExternalChat(
    mapping.slackWorkspaceId,
    mapping.slackChannelId,
    sessionId,
    mapping.externalChatId,
  )

  // Another connect got there first: its record is the channel's.
  if (kept !== sessionId) await agentConversations().deleteOne({ sessionId })

  return kept ?? sessionId
}
