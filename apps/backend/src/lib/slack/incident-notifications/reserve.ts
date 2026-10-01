import { randomUUID } from 'node:crypto'

import { bindSlackAgentThread, getSlackAgentThreadBySessionId } from '@/lib/slack/agent-bot'
import { completeSlackIncidentPost } from '@/lib/slack/incident-notifications/lifecycle'
import {
  RESERVATION_LEASE_MS,
  isDuplicateKeyError,
  planSlackIncidentPost,
  postCountInWindow,
  slackIncidentRevisionFilter,
  slackNotificationIncidents,
  threadPointer,
} from '@/lib/slack/incident-notifications/model'

import type {
  SlackIncidentPendingAction,
  SlackIncidentPlacement,
  SlackIncidentReserveResult,
} from '@/lib/slack/incident-notifications/model'

export async function reserveSlackIncidentPost(input: {
  teamId: string
  slackWorkspaceId: string
  slackChannelId: string
  triggerId: string
  incidentScope?: string
  placement: SlackIncidentPlacement
  contentHash: string
  sessionId: string
  triggerConfigRevision: number
  threadBelongsToAlert?: boolean
  now?: Date
}): Promise<SlackIncidentReserveResult> {
  const collection = slackNotificationIncidents()
  const key = {
    teamId: input.teamId,
    slackWorkspaceId: input.slackWorkspaceId,
    slackChannelId: input.slackChannelId,
    triggerId: input.triggerId,
    incidentScope: input.incidentScope ?? 'default',
  }

  // Optimistic loop: revision is the monotonic compare-and-swap token. The
  // unique key handles two replicas racing to create the first row; pending
  // handles two replicas racing to post into an existing one.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const now = input.now ?? new Date()
    const existing = await collection.findOne(key)

    if (existing && (existing.triggerConfigRevision ?? 0) !== input.triggerConfigRevision) {
      // The trigger was rerouted, disabled/re-enabled, or otherwise changed
      // after this run began. Remove only the stale CAS version so the current
      // revision starts clean.
      await collection.deleteOne({
        _id: existing._id,
        ...slackIncidentRevisionFilter(existing),
      })
      continue
    }
    if (existing?.pending && existing.pending.expiresAt.getTime() <= now.getTime()) {
      if (existing.pending.delivery) {
        try {
          if (existing.pending.action === 'post_root') {
            const boundThread = await getSlackAgentThreadBySessionId(existing.pending.sessionId)

            if (!boundThread) {
              await bindSlackAgentThread({
                slackWorkspaceId: existing.slackWorkspaceId,
                slackChannelId: existing.slackChannelId,
                slackThreadTs: existing.pending.delivery.rootThreadTs,
                teamId: existing.teamId,
                agentUserId: existing.pending.delivery.agentUserId,
                sessionId: existing.pending.sessionId,
                createdBySlackUserId: existing.pending.delivery.createdBySlackUserId,
              })
            } else if (
              boundThread.teamId !== existing.teamId ||
              boundThread.slackWorkspaceId !== existing.slackWorkspaceId ||
              boundThread.slackChannelId !== existing.slackChannelId ||
              boundThread.slackThreadTs !== existing.pending.delivery.rootThreadTs
            ) {
              throw new Error('Accepted Slack incident root is bound to a different conversation')
            }
          }
          await completeSlackIncidentPost(
            {
              recordId: existing._id!,
              token: existing.pending.token,
              action: existing.pending.action,
              contentHash: existing.pending.contentHash,
              sessionId: existing.pending.sessionId,
              triggerConfigRevision:
                existing.pending.triggerConfigRevision ?? existing.triggerConfigRevision ?? 0,
              createdNew: false,
              threadTs: existing.pending.delivery.rootThreadTs,
              postWindowStartedAt: existing.postWindowStartedAt ?? existing.updateWindowStartedAt,
              postCountInWindow: postCountInWindow(existing, now),
              identity: key,
            },
            { threadTs: existing.pending.delivery.rootThreadTs, now },
          )
          continue
        } catch {
          // Slack already accepted this message. Keep suppressing until a later
          // delivery can reconcile; never post a duplicate to escape a
          // transient binding/database failure.
          await collection.updateOne(
            { _id: existing._id, 'pending.token': existing.pending.token },
            {
              $set: {
                'pending.expiresAt': new Date(now.getTime() + RESERVATION_LEASE_MS),
                updatedAt: now,
              },
              $inc: { revision: 1 },
            },
          )

          return {
            action: 'suppress',
            reason: 'concurrent_delivery',
            threadTs: existing.pending.delivery.rootThreadTs,
          }
        }
      }

      if (existing.pending.action === 'post_root') {
        // Backward-compatible crash recovery for reservations created before
        // delivery evidence was stored. A durable thread binding still proves
        // Slack accepted the root.
        const boundThread = await getSlackAgentThreadBySessionId(existing.pending.sessionId)

        if (
          boundThread &&
          boundThread.teamId === input.teamId &&
          boundThread.slackWorkspaceId === input.slackWorkspaceId &&
          boundThread.slackChannelId === input.slackChannelId
        ) {
          const recovered = await collection.updateOne(
            { _id: existing._id, 'pending.token': existing.pending.token },
            {
              $set: {
                latestThreadTs: boundThread.slackThreadTs,
                latestSessionId: boundThread.sessionId,
                lastContentHash: existing.pending.contentHash,
                lastNotificationAt: now,
                updatedAt: now,
              },
              $inc: { revision: 1 },
              $unset: { pending: '' },
            },
          )

          if (recovered.matchedCount > 0) continue
        }
      }
    }

    const plan = planSlackIncidentPost(existing, input, now)

    if (plan.action === 'suppress') {
      return {
        ...plan,
        ...(threadPointer(existing) ? { threadTs: threadPointer(existing)! } : {}),
      }
    }

    const token = randomUUID()
    const pending: SlackIncidentPendingAction = {
      token,
      action: plan.action,
      contentHash: input.contentHash,
      sessionId: input.sessionId,
      triggerConfigRevision: input.triggerConfigRevision,
      expiresAt: new Date(now.getTime() + RESERVATION_LEASE_MS),
    }

    if (!existing) {
      try {
        const inserted = await collection.insertOne({
          ...key,
          triggerConfigRevision: input.triggerConfigRevision,
          revision: 0,
          postCountInWindow: 0,
          totalPostCount: 0,
          pending,
          createdAt: now,
          updatedAt: now,
        })

        return {
          action: 'post_root',
          reservation: {
            recordId: inserted.insertedId,
            token,
            action: 'post_root',
            contentHash: input.contentHash,
            sessionId: input.sessionId,
            triggerConfigRevision: input.triggerConfigRevision,
            createdNew: true,
            postCountInWindow: 0,
            identity: key,
          },
        }
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err
        continue
      }
    }

    const updated = await collection.findOneAndUpdate(
      { _id: existing._id, ...slackIncidentRevisionFilter(existing) },
      {
        $set: {
          pending,
          triggerConfigRevision: input.triggerConfigRevision,
          updatedAt: now,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    )

    if (!updated) continue

    return {
      action: plan.action,
      reservation: {
        recordId: updated._id!,
        token,
        action: plan.action,
        contentHash: input.contentHash,
        sessionId: input.sessionId,
        triggerConfigRevision: input.triggerConfigRevision,
        createdNew: false,
        ...(plan.action === 'post_thread' ? { threadTs: plan.threadTs } : {}),
        postWindowStartedAt: existing.postWindowStartedAt ?? existing.updateWindowStartedAt,
        postCountInWindow: postCountInWindow(existing, now),
        identity: key,
      },
    }
  }

  return { action: 'suppress', reason: 'concurrent_delivery' }
}
