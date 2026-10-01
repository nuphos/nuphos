import { createHash } from 'node:crypto'

import { logEvent } from '@/lib/observability'

import type { SlackOutboundDependencies } from '@/lib/slack/agent-outbound/types'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'
import type {
  SlackIncidentReservation,
  SlackTriggerNotificationContext,
} from '@/lib/slack/incident-notifications'

export function slackTriggerDestinationMismatch(
  approved: SlackTriggerNotificationContext['approvedDestination'],
  destination: SlackOutboundDestination,
): boolean {
  const exactMatch =
    approved.type === destination.type &&
    (approved.type === 'dm_self' ||
      (destination.type === 'channel' &&
        destination.channelId === approved.channelId &&
        // Workspace comparison is lenient when either side predates
        // workspace-qualified destinations.
        (!approved.slackWorkspaceId ||
          !destination.slackWorkspaceId ||
          destination.slackWorkspaceId === approved.slackWorkspaceId)))

  return !exactMatch
}

export type SlackIncidentReserveOutcome =
  | { kind: 'proceed'; reservation: SlackIncidentReservation; threadTs?: string }
  | { kind: 'reject'; error: string }
  | {
      kind: 'suppressed'
      rootThreadTs?: string
      suppressedReason: string
      threadBound: boolean
    }

export async function reserveSlackIncidentForPost(input: {
  dependencies: SlackOutboundDependencies
  teamId: string
  conversationId: string
  triggerNotification: SlackTriggerNotificationContext
  sendWorkspaceId: string
  channelId: string
  text: string
  replyToThread?: string
  alertThreads: string[]
}): Promise<SlackIncidentReserveOutcome> {
  const { dependencies, teamId, triggerNotification, sendWorkspaceId, channelId } = input
  const reserved = await dependencies.reserveIncident({
    teamId,
    slackWorkspaceId: sendWorkspaceId,
    slackChannelId: channelId,
    triggerId: triggerNotification.triggerId,
    incidentScope: triggerNotification.incidentScope,
    placement: input.replyToThread
      ? { type: 'reply', threadTs: input.replyToThread }
      : { type: 'new_thread' },
    contentHash: createHash('sha256').update(input.text).digest('hex'),
    sessionId: input.conversationId,
    triggerConfigRevision: triggerNotification.triggerConfigRevision,
    ...(input.replyToThread
      ? { threadBelongsToAlert: input.alertThreads.includes(input.replyToThread) }
      : {}),
  })

  if (reserved.action === 'suppress') {
    logEvent('info', 'slack.incident_notification.suppressed', {
      team_id: teamId,
      trigger_id: triggerNotification.triggerId,
      slack_workspace_id: sendWorkspaceId,
      slack_channel_id: channelId,
      reason: reserved.reason,
    })
    // The thread the model asked for is not one of this alert's own.
    // That is a correctable mistake, not a delivery decision, so it
    // does not spend the turn.
    if (reserved.reason === 'unknown_thread') {
      return {
        kind: 'reject',
        error:
          'That Slack thread does not belong to this alert. Reply only in a thread from incident_history, or omit replyToThread to start a new one.',
      }
    }

    return {
      kind: 'suppressed',
      ...(reserved.threadTs ? { rootThreadTs: reserved.threadTs } : {}),
      suppressedReason: reserved.reason,
      threadBound: Boolean(reserved.threadTs),
    }
  }

  return {
    kind: 'proceed',
    reservation: reserved.reservation,
    ...(reserved.action === 'post_thread' ? { threadTs: reserved.reservation.threadTs } : {}),
  }
}
