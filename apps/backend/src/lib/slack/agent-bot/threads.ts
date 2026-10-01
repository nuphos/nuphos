import { randomUUID } from 'node:crypto'

import { clipTranscriptText } from '@/lib/agent/thread-addressing-core'
import { SLACK_THREAD_WINDOW, slackAgentThreads } from '@/lib/slack/agent-bot/collections'

import type {
  SlackAgentThread,
  SlackAgentThreadSummary,
  SlackThreadMessageRecord,
} from '@/lib/slack/agent-bot/collections'

export async function getOrCreateSlackAgentThread(data: {
  slackWorkspaceId: string
  slackChannelId: string
  slackThreadTs: string
  teamId: string
  agentUserId: string
  createdBySlackUserId: string
  lastSlackEventId: string
}): Promise<{ thread: SlackAgentThread; isNew: boolean }> {
  const now = new Date()
  const sessionId = randomUUID()
  const thread = await slackAgentThreads().findOneAndUpdate(
    {
      slackWorkspaceId: data.slackWorkspaceId,
      slackChannelId: data.slackChannelId,
      slackThreadTs: data.slackThreadTs,
    },
    {
      $setOnInsert: {
        sessionId,
        teamId: data.teamId,
        agentUserId: data.agentUserId,
        createdBySlackUserId: data.createdBySlackUserId,
        origin: 'slack',
        createdAt: now,
      },
      $set: {
        lastSlackEventId: data.lastSlackEventId,
        lastActiveAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' },
  )

  if (!thread) throw new Error('Failed to create Slack agent thread')

  return { thread, isNew: thread.sessionId === sessionId }
}

/**
 * Append one line to a thread's rolling transcript, trimming to the newest
 * SLACK_THREAD_WINDOW entries. Best-effort: losing a line degrades the
 * addressing judge's context, never the turn, so callers do not await failures
 * into their own error paths. A ts already at the tail is skipped so a Slack
 * redelivery cannot double-record.
 */
export async function appendSlackThreadMessage(
  key: { slackWorkspaceId: string; slackChannelId: string; slackThreadTs: string },
  message: SlackThreadMessageRecord,
): Promise<void> {
  const text = message.text.trim()

  if (!text) return
  await slackAgentThreads().updateOne(
    { ...key, 'recentMessages.ts': { $ne: message.ts } },
    {
      $push: {
        recentMessages: {
          $each: [{ ...message, text: clipTranscriptText(text, { fromBot: message.fromBot }) }],
          $slice: -SLACK_THREAD_WINDOW,
        },
      },
      $set: { lastActiveAt: new Date() },
    },
  )
}

export async function getSlackAgentThread(
  slackWorkspaceId: string,
  slackChannelId: string,
  slackThreadTs: string,
): Promise<SlackAgentThread | null> {
  return await slackAgentThreads().findOne({
    slackWorkspaceId,
    slackChannelId,
    slackThreadTs,
  })
}

export async function getSlackAgentThreadBySessionId(
  sessionId: string,
): Promise<SlackAgentThread | null> {
  return await slackAgentThreads().findOne({ sessionId })
}

/**
 * Batch companion to getSlackAgentThreadBySessionId for conversation lists.
 * sessionId is uniquely indexed, so one $in query enriches the entire page
 * without an N+1 round trip per conversation.
 */
export async function getSlackAgentThreadsBySessionIds(
  sessionIds: readonly string[],
): Promise<SlackAgentThreadSummary[]> {
  if (sessionIds.length === 0) return []

  return await slackAgentThreads()
    .find<SlackAgentThreadSummary>(
      { sessionId: { $in: [...new Set(sessionIds)] } },
      {
        projection: {
          _id: 0,
          sessionId: 1,
          origin: 1,
        },
      },
    )
    .toArray()
}
