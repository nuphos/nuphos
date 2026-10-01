import { fenceUntrusted, UNTRUSTED_NOTE } from '@/lib/agent/untrusted-content'

import type { SlackOutboundDestination } from '@/lib/slack/destinations'

/**
 * What the server tells the agent before it handles an alert.
 *
 * Only two kinds of thing belong here: facts the agent cannot discover for
 * itself (where it is allowed to post, how often it has already posted), and
 * what its job is. Everything else — whether this is the same problem as last
 * time, whether it is worth interrupting anyone, whether it has recovered — is
 * the agent's to work out, with the same tools a person would use.
 */
export function incidentDeliveryPolicy(input: {
  /** The provider's own words, unclassified. */
  reportedStatus?: string
  approvedDestination?: SlackOutboundDestination
  hasPriorOccurrences?: boolean
  /** The agent's own recent posting rate for this alert. */
  postsInLastHour?: number
  busyThreshold: number
}): string {
  const destination = input.approvedDestination
  const lines = [
    '',
    '[Monitoring delivery policy — server supplied]',
    'You are the on-call for this alert. It just paged you.',
    // The status is arbitrary webhook text. Interpolating it bare would let a
    // payload close the quoting and read as server-supplied policy, so it is
    // fenced like any other third-party content.
    ...(input.reportedStatus
      ? [
          'The provider reports the alert state as the text below. Read it and the payload and decide what it means; the server does not interpret it for you.',
          fenceUntrusted('untrusted-provider-status', input.reportedStatus, UNTRUSTED_NOTE),
        ]
      : []),
  ]

  if (destination) {
    const workspaceField =
      destination.type === 'channel' && destination.slackWorkspaceId
        ? `,"slackWorkspaceId":"${destination.slackWorkspaceId}"`
        : ''

    lines.push(
      destination.type === 'channel'
        ? `You may post only to slack_post destination {"type":"channel","channelId":"${destination.channelId}"${workspaceField}}. Any other destination is refused.`
        : 'You may post only to slack_post destination {"type":"dm_self"}. Any other destination is refused — do not post this to a channel.',
    )
  }

  lines.push(
    input.hasPriorOccurrences
      ? 'This alert has gone off before. Call incident_history to see when, what was said, and in which thread.'
      : 'The server has no record of this alert firing before, but check incident_history yourself rather than taking that as final.',
    'Look before you announce, the way you would glance at the channel after being paged: incident_history for this alert’s own past firings, slack_read_channel for what is already in the channel, conversation_get to read how an earlier one was actually investigated.',
    'Then write. slack_post takes a destination and text; pass replyToThread with a threadTs from incident_history to continue that thread, or omit it to start a new one. There is no message type to choose and nothing to classify — decide where it belongs and say it, exactly as you would in Slack.',
    'If this firing is the same problem still going or coming back, continue its thread. Open a new one only when it is genuinely a different problem. When it has recovered, say so in its thread and stop — nothing needs to be closed.',
    'Post something quickly so whoever is watching knows it is being looked at, then investigate and follow up in the same thread when you know more.',
  )

  if (input.postsInLastHour !== undefined && input.postsInLastHour > 0) {
    lines.push(
      input.postsInLastHour >= input.busyThreshold
        ? `You have already posted about this alert ${String(input.postsInLastHour)} time(s) in the past hour. That is a lot of interruptions — say something more only if it changes what someone would do.`
        : `You have posted about this alert ${String(input.postsInLastHour)} time(s) in the past hour.`,
    )
  }

  lines.push(
    'The server guarantees only that the same message is never delivered twice and that two runs cannot post at once. It will not second-guess whether a message was worth sending — that judgment is yours, so make it the way an on-call engineer who respects their team would.',
  )

  return lines.join('\n')
}
