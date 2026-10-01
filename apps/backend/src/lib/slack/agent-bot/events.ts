import {
  slackAssistantThreadContexts,
  slackProcessedEvents,
  slackReplyFeedback,
} from '@/lib/slack/agent-bot/collections'

import type { SlackProcessedEvent } from '@/lib/slack/agent-bot/collections'

// Longer than the 45-minute headless-turn fuse. Even if Mongo heartbeats are
// temporarily unavailable, Slack retry delivery cannot reclaim an event while
// its original turn is still allowed to execute. The heartbeat below retains
// crash recovery without making a healthy long turn replayable.
const PROCESSING_LEASE_MS = 60 * 60_000

export async function setSlackAssistantThreadContext(data: {
  slackWorkspaceId: string
  slackChannelId: string
  slackThreadTs: string
  contextChannelId?: string
}): Promise<void> {
  await slackAssistantThreadContexts().updateOne(
    {
      slackWorkspaceId: data.slackWorkspaceId,
      slackChannelId: data.slackChannelId,
      slackThreadTs: data.slackThreadTs,
    },
    {
      $set: {
        ...(data.contextChannelId ? { contextChannelId: data.contextChannelId } : {}),
        updatedAt: new Date(),
      },
      // Context can be cleared (the user navigated somewhere without a
      // channel); keep the row but drop the stale channel.
      ...(data.contextChannelId ? {} : { $unset: { contextChannelId: '' } }),
    },
    { upsert: true },
  )
}

export async function getSlackAssistantThreadContext(
  slackWorkspaceId: string,
  slackChannelId: string,
  slackThreadTs: string,
): Promise<string | undefined> {
  const doc = await slackAssistantThreadContexts().findOne({
    slackWorkspaceId,
    slackChannelId,
    slackThreadTs,
  })

  return doc?.contextChannelId ?? undefined
}

export async function claimSlackEvent(data: {
  eventId: string
  slackWorkspaceId?: string
  slackChannelId?: string
  slackThreadTs?: string
  eventTs?: string
}): Promise<boolean> {
  const now = new Date()
  const processingExpiresAt = new Date(now.getTime() + PROCESSING_LEASE_MS)

  try {
    await slackProcessedEvents().insertOne({
      eventId: data.eventId,
      slackWorkspaceId: data.slackWorkspaceId,
      slackChannelId: data.slackChannelId,
      slackThreadTs: data.slackThreadTs,
      eventTs: data.eventTs,
      status: 'processing',
      processingExpiresAt,
      createdAt: now,
      updatedAt: now,
    })

    return true
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err
    const result = await slackProcessedEvents().findOneAndUpdate(
      {
        eventId: data.eventId,
        status: 'processing',
        processingExpiresAt: { $lt: now },
      },
      {
        $set: {
          slackWorkspaceId: data.slackWorkspaceId,
          slackChannelId: data.slackChannelId,
          slackThreadTs: data.slackThreadTs,
          eventTs: data.eventTs,
          status: 'processing',
          processingExpiresAt,
          updatedAt: now,
        },
        $unset: { error: '' },
      },
      { returnDocument: 'after' },
    )

    return result !== null
  }
}

/** Keep a detached long-running Slack event from becoming reclaimable while
 * its agent turn is still alive. Conditional on `processing` so a late pulse
 * can never resurrect a terminal event. */
export async function refreshSlackEventClaim(eventId: string): Promise<void> {
  const now = new Date()

  await slackProcessedEvents().updateOne(
    { eventId, status: 'processing' },
    {
      $set: {
        processingExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
        updatedAt: now,
      },
    },
  )
}

export async function markSlackEvent(
  eventId: string,
  status: SlackProcessedEvent['status'],
  error?: string,
): Promise<void> {
  await slackProcessedEvents().updateOne(
    { eventId },
    {
      $set: {
        status,
        ...(error ? { error: error.slice(0, 1000) } : {}),
        updatedAt: new Date(),
      },
      $unset: { processingExpiresAt: '', ...(error ? {} : { error: '' }) },
    },
  )
}

export async function upsertSlackReplyFeedback(data: {
  slackWorkspaceId: string
  slackChannelId: string
  messageTs: string
  slackUserId: string
  sessionId?: string
  verdict: 'up' | 'down'
}): Promise<void> {
  const now = new Date()

  await slackReplyFeedback().updateOne(
    {
      slackWorkspaceId: data.slackWorkspaceId,
      slackChannelId: data.slackChannelId,
      messageTs: data.messageTs,
      slackUserId: data.slackUserId,
    },
    {
      $setOnInsert: { createdAt: now },
      $set: {
        ...(data.sessionId ? { sessionId: data.sessionId } : {}),
        verdict: data.verdict,
        updatedAt: now,
      },
    },
    { upsert: true },
  )
}
