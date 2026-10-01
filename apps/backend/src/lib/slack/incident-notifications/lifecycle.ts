import { logEvent } from '@/lib/observability'
import {
  SLACK_INCIDENT_POST_WINDOW_MS,
  postCountInWindow,
  slackNotificationIncidents,
  threadPointer,
} from '@/lib/slack/incident-notifications/model'
import { recordIncidentMessage } from '@/lib/slack/incident-occurrences'

import type { SlackIncidentReservation } from '@/lib/slack/incident-notifications/model'

/** Persist Slack acceptance before thread binding/finalization side effects. */
export async function recordSlackIncidentDelivery(
  reservation: SlackIncidentReservation,
  delivery: {
    rootThreadTs: string
    agentUserId: string
    createdBySlackUserId?: string
    now?: Date
  },
): Promise<void> {
  const now = delivery.now ?? new Date()
  const result = await slackNotificationIncidents().updateOne(
    {
      _id: reservation.recordId,
      'pending.token': reservation.token,
      'pending.triggerConfigRevision': reservation.triggerConfigRevision,
    },
    {
      $set: {
        'pending.delivery': {
          rootThreadTs: delivery.rootThreadTs,
          agentUserId: delivery.agentUserId,
          ...(delivery.createdBySlackUserId
            ? { createdBySlackUserId: delivery.createdBySlackUserId }
            : {}),
          deliveredAt: now,
        },
        updatedAt: now,
      },
      $inc: { revision: 1 },
    },
  )

  if (result.matchedCount === 0) {
    throw new Error('Slack incident reservation ownership was lost after delivery')
  }
}

export async function completeSlackIncidentPost(
  reservation: SlackIncidentReservation,
  result: { threadTs: string; now?: Date; text?: string; startedNewThread?: boolean },
): Promise<void> {
  const now = result.now ?? new Date()
  const windowOpen =
    reservation.postWindowStartedAt &&
    now.getTime() - reservation.postWindowStartedAt.getTime() < SLACK_INCIDENT_POST_WINDOW_MS
  const nextWindowStart = windowOpen ? reservation.postWindowStartedAt! : now
  const nextCount = windowOpen ? reservation.postCountInWindow + 1 : 1
  const completed = await slackNotificationIncidents().updateOne(
    {
      _id: reservation.recordId,
      'pending.token': reservation.token,
      'pending.triggerConfigRevision': reservation.triggerConfigRevision,
    },
    {
      $set: {
        latestThreadTs: result.threadTs,
        latestSessionId: reservation.sessionId,
        lastContentHash: reservation.contentHash,
        lastNotificationAt: now,
        postWindowStartedAt: nextWindowStart,
        postCountInWindow: nextCount,
        updatedAt: now,
        // Compat for one rollout: the previous release locates a live incident
        // by `{ state: 'open', rootSessionId }` and posts into `rootThreadTs`.
        // Leaving these unwritten would let an old pod fail to find the thread
        // while still refusing to open a new one — silencing that firing.
        state: 'open',
        rootThreadTs: result.threadTs,
        rootSessionId: reservation.sessionId,
        updateWindowStartedAt: nextWindowStart,
        updateCountInWindow: nextCount,
      },
      $inc: {
        revision: 1,
        totalPostCount: 1,
        totalUpdateCount: 1,
        // A new thread is a new generation in the old model.
        ...(reservation.action === 'post_root' ? { generation: 1 } : {}),
      },
      $unset: { pending: '' },
    },
  )

  if (completed.matchedCount === 0) {
    throw new Error('Slack incident reservation ownership was lost before completion')
  }
  // The ledger is what a later on-call reads, and what makes a thread
  // addressable at all: without the threadTs recorded here, incident_history
  // has nothing to offer and a reply can never be validated. It is still only
  // history, so it never fails a delivery Slack has already accepted.
  try {
    await recordIncidentMessage({
      teamId: reservation.identity.teamId,
      triggerId: reservation.identity.triggerId,
      incidentScope: reservation.identity.incidentScope,
      sessionId: reservation.sessionId,
      slackThreadTs: result.threadTs,
      startedNewThread: result.startedNewThread ?? reservation.action === 'post_root',
      // A lease-recovery replay completes without the original prose. Passing an
      // empty string would blank what the agent actually said — the one field
      // the next firing reads to judge whether it is the same problem.
      ...(result.text ? { text: result.text } : {}),
      at: now,
    })
  } catch (err) {
    logEvent('warn', 'slack.incident_occurrence.message_record_failed', {
      team_id: reservation.identity.teamId,
      trigger_id: reservation.identity.triggerId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function abortSlackIncidentPost(reservation: SlackIncidentReservation): Promise<void> {
  const collection = slackNotificationIncidents()

  if (reservation.createdNew) {
    const aborted = await collection.deleteOne({
      _id: reservation.recordId,
      'pending.token': reservation.token,
      'pending.triggerConfigRevision': reservation.triggerConfigRevision,
      latestThreadTs: { $exists: false },
    })

    if (aborted.deletedCount === 0) {
      throw new Error('Slack incident reservation ownership was lost before abort')
    }

    return
  }
  const aborted = await collection.updateOne(
    {
      _id: reservation.recordId,
      'pending.token': reservation.token,
      'pending.triggerConfigRevision': reservation.triggerConfigRevision,
    },
    { $unset: { pending: '' }, $set: { updatedAt: new Date() }, $inc: { revision: 1 } },
  )

  if (aborted.matchedCount === 0) {
    throw new Error('Slack incident reservation ownership was lost before abort')
  }
}

/** How busy this alert's channel already is, for the model to weigh. */
export async function getSlackIncidentPostingRate(
  teamId: string | undefined,
  triggerId: string,
  incidentScope = 'default',
  now = new Date(),
): Promise<{ postsInLastHour: number; lastPostedAt?: Date; latestThreadTs?: string }> {
  if (!teamId) return { postsInLastHour: 0 }
  const record = await slackNotificationIncidents().findOne(
    { teamId, triggerId, incidentScope },
    { sort: { updatedAt: -1 } },
  )

  if (!record) return { postsInLastHour: 0 }

  return {
    postsInLastHour: postCountInWindow(record, now),
    ...(record.lastNotificationAt ? { lastPostedAt: record.lastNotificationAt } : {}),
    ...(threadPointer(record) ? { latestThreadTs: threadPointer(record)! } : {}),
  }
}

export async function clearSlackNotificationIncidentsForTrigger(
  triggerId: string,
  teamId?: string,
): Promise<void> {
  await slackNotificationIncidents().deleteMany({
    triggerId,
    ...(teamId ? { teamId } : {}),
  })
}
