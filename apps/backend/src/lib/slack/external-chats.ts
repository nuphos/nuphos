import { randomUUID } from 'node:crypto'

import { agentConversations, agentMessages } from '@/lib/agent/db'
import { assertBot } from '@/lib/agent/db/bot-membership'
import { setSlackChannelExternalChat } from '@/lib/slack/agent-bot'

import type { SlackChannelMapping } from '@/lib/slack/agent-bot'

/**
 * A connected channel's hidden record (#3702): what its Bots read and post
 * there. Made on first connect, kept while the channel stays connected, and
 * deleted with its messages when an admin disconnects it.
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

/** A channel answers with one Bot (#3702): it comes in only while no other is there. */
export async function bringExternalChatBot(
  externalChatId: string,
  botSessionId: string,
): Promise<boolean> {
  await assertBot(botSessionId)
  const { matchedCount } = await agentConversations().updateOne(
    {
      sessionId: externalChatId,
      external: 'slack',
      // No Bot there but this one.
      agentSessionIds: { $not: { $elemMatch: { $ne: botSessionId } } },
    },
    { $set: { agentSessionIds: [botSessionId] } },
  )

  return matchedCount > 0
}

/** A disconnected channel's record goes, with the Slack messages it held. */
export async function removeExternalChat(externalChatId: string): Promise<void> {
  await agentMessages().deleteMany({ sessionId: externalChatId })
  await agentConversations().deleteOne({ sessionId: externalChatId, external: 'slack' })
}
