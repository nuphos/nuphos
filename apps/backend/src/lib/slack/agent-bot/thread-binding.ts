import { clipTranscriptText } from '@/lib/agent/thread-addressing-core'
import { slackAgentThreads } from '@/lib/slack/agent-bot/collections'

import type { SlackAgentThread } from '@/lib/slack/agent-bot/collections'

/**
 * Bind a Slack root message to an existing Nuphos conversation. A session is
 * intentionally bound to at most one Slack root: one trigger firing creates
 * one incident conversation and one replyable notification thread.
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

/**
 * Hand an existing thread to the run that is now working this alert, so replies
 * reach the live investigation rather than the run that handled the last
 * firing. sessionId is uniquely indexed, so this is a move, not a second
 * binding: the adopting run must not already own a thread.
 */
export async function rebindSlackAgentThreadSession(data: {
  slackWorkspaceId: string
  slackChannelId: string
  slackThreadTs: string
  sessionId: string
  /** The team this run belongs to. A thread is only ever handed within it. */
  teamId: string
  agentUserId: string
}): Promise<void> {
  const rootKey = {
    slackWorkspaceId: data.slackWorkspaceId,
    slackChannelId: data.slackChannelId,
    slackThreadTs: data.slackThreadTs,
  }
  const existingRoot = await slackAgentThreads().findOne(rootKey)

  if (!existingRoot) throw new Error('That Slack thread is not bound to any Nuphos conversation')
  // The root key is workspace + channel + ts only, and a channel can be shared
  // with another Nuphos team through a mapping grant. Without this, that team's
  // thread could be moved onto this run and its inbound replies redirected.
  // bindSlackAgentThread makes the same check; this path must fail closed too.
  if (existingRoot.teamId !== data.teamId || existingRoot.agentUserId !== data.agentUserId) {
    throw new Error('That Slack thread belongs to a different Nuphos conversation owner')
  }
  if (existingRoot.sessionId === data.sessionId) return

  const existingSession = await slackAgentThreads().findOne({ sessionId: data.sessionId })

  if (existingSession) {
    throw new Error('This Nuphos conversation is already bound to a Slack thread')
  }
  // Compare-and-swap on the old session: matching nothing means another
  // delivery already moved the thread, and the caller must not be told this
  // one succeeded.
  let moved

  try {
    moved = await slackAgentThreads().updateOne(
      { _id: existingRoot._id, sessionId: existingRoot.sessionId },
      { $set: { sessionId: data.sessionId, lastActiveAt: new Date() } },
    )
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err
    throw new Error('This Nuphos conversation is already bound to a Slack thread', {
      cause: err,
    })
  }
  if (moved.matchedCount === 0) {
    throw new Error('That Slack thread was rebound to another conversation concurrently')
  }
}
