import { clipTranscriptText } from '@/lib/agent/thread-transcript'
import { slackAgentThreads } from '@/lib/slack/agent-bot/collections'

import type { SlackAgentThread } from '@/lib/slack/agent-bot/collections'

/**
 * Bind a Slack root message to an existing Nuphos conversation. A session is
 * intentionally bound to at most one Slack root.
 */
export async function bindSlackAgentThread(data: {
  slackWorkspaceId: string
  slackChannelId: string
  slackThreadTs: string
  teamId: string
  agentUserId: string
  sessionId: string
  createdBySlackUserId?: string
  // How this binding came to exist. 'agent_notification' (the default) is a
  // proactive root the agent posted; 'user_pickup' is a DM root created because
  // the user asked to continue this conversation from Slack.
  origin?: 'agent_notification' | 'user_pickup'
  // The notification the bot just posted. Seeds the rolling transcript so the
  // addressing judge can tell a reply to the alert from teammates discussing
  // it — without this, a notification thread's first reply has no history.
  rootText?: string
  // Untruncated text handed to the thread's own first turn. Set only when
  // sessionId is a fresh fork that has no transcript to read from.
  notificationContext?: string
}): Promise<SlackAgentThread> {
  const rootKey = {
    slackWorkspaceId: data.slackWorkspaceId,
    slackChannelId: data.slackChannelId,
    slackThreadTs: data.slackThreadTs,
  }
  const existingRoot = await slackAgentThreads().findOne(rootKey)

  if (existingRoot) {
    if (
      existingRoot.sessionId === data.sessionId &&
      existingRoot.teamId === data.teamId &&
      existingRoot.agentUserId === data.agentUserId
    ) {
      return existingRoot
    }
    throw new Error('That Slack thread is already bound to another Nuphos conversation')
  }

  const existingSession = await slackAgentThreads().findOne({ sessionId: data.sessionId })

  if (existingSession) {
    throw new Error('This Nuphos conversation is already bound to a Slack thread')
  }

  const now = new Date()
  const thread: SlackAgentThread = {
    ...rootKey,
    teamId: data.teamId,
    agentUserId: data.agentUserId,
    sessionId: data.sessionId,
    createdBySlackUserId: data.createdBySlackUserId ?? '',
    origin: data.origin ?? 'agent_notification',
    ...(data.rootText?.trim()
      ? {
          recentMessages: [
            {
              ts: data.slackThreadTs,
              authorName: 'Nuphos',
              text: clipTranscriptText(data.rootText, { fromBot: true }),
              fromBot: true,
            },
          ],
        }
      : {}),
    ...(data.notificationContext?.trim()
      ? { notificationContext: data.notificationContext.trim() }
      : {}),
    createdAt: now,
    lastActiveAt: now,
  }

  try {
    const result = await slackAgentThreads().insertOne(thread)

    return { ...thread, _id: result.insertedId }
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err
    // An idempotent retry can race the first insert. Re-read both unique keys
    // and accept only the exact same binding; every other duplicate is a real
    // ownership conflict.
    const raced =
      (await slackAgentThreads().findOne(rootKey)) ??
      (await slackAgentThreads().findOne({ sessionId: data.sessionId }))

    if (
      raced &&
      raced.slackWorkspaceId === data.slackWorkspaceId &&
      raced.slackChannelId === data.slackChannelId &&
      raced.slackThreadTs === data.slackThreadTs &&
      raced.sessionId === data.sessionId &&
      raced.teamId === data.teamId &&
      raced.agentUserId === data.agentUserId
    ) {
      return raced
    }
    throw new Error('Could not bind this conversation to the Slack thread', { cause: err })
  }
}
