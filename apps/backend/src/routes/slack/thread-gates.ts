import { getTeamMembership } from '@/lib/identity'
import { getSlackChannelMapping, markSlackEvent } from '@/lib/slack/agent-bot'
import { getAgentNotificationReplyAccess } from '@/lib/slack/thread-access'
import { postSenderNotice, postThreadMessage } from '@/routes/slack/shared'

import type { SlackAgentThread } from '@/lib/slack/agent-bot'
import type { SlackRuntime } from '@/routes/slack/types'

// May this reply keep driving the thread's Nuphos team? Returns false after
// telling the thread and completing the event.
export async function verifyThreadTeamAccess(args: {
  runtime: SlackRuntime
  botNuphosTeamId: string
  thread: SlackAgentThread
  slackWorkspaceId: string
  channelId: string
  threadTs: string
  eventId: string
}): Promise<boolean> {
  const { runtime, thread, channelId, threadTs, eventId } = args

  if (thread.origin === 'agent_notification') {
    // The outbound tool already authenticated and bound this exact team,
    // workspace and root message. Do not require a separate inbound channel
    // mapping just to continue it, but still fail closed if neither the
    // installation nor a channel grant still resolves to the thread's team —
    // a cross-workspace team posts through another team's installation, so
    // its notification threads authenticate via the channel mapping instead.
    // Fail closed visibly: the people replying here were mid-conversation
    // with the agent and must not be left guessing why it went quiet.
    if (args.botNuphosTeamId !== thread.teamId) {
      const grant = await getSlackChannelMapping(args.slackWorkspaceId, channelId)

      if (grant?.teamId !== thread.teamId) {
        await postThreadMessage(
          runtime,
          channelId,
          threadTs,
          "This thread's Nuphos team no longer has Slack access here, so I can't act on replies in it.",
        )
        await markSlackEvent(eventId, 'completed')

        return false
      }
    }

    return true
  }
  const mapping = await getSlackChannelMapping(args.slackWorkspaceId, channelId)

  if (!mapping || mapping.teamId !== thread.teamId) {
    await postThreadMessage(
      runtime,
      channelId,
      threadTs,
      !mapping
        ? "This channel is no longer linked to Nuphos, so I can't act on replies in this thread. A team administrator can re-link it from my DM."
        : "This channel is now linked to a different Nuphos team, so I can't continue this conversation. Mention me in a new message to start fresh.",
    )
    await markSlackEvent(eventId, 'completed')

    return false
  }

  return true
}

// Gate for replies in agent-notification threads: only the intended recipient
// (DM) or a current team member may continue them. Returns false after telling
// the sender (only them) and completing the event.
export async function checkNotificationReplyAccess(args: {
  runtime: SlackRuntime
  thread: SlackAgentThread
  senderNuphosUserId: string
  senderSlackUserId: string
  channelId: string
  threadTs: string
  eventId: string
}): Promise<boolean> {
  const { thread } = args
  const membership = await getTeamMembership(args.senderNuphosUserId, thread.teamId)
  const access = getAgentNotificationReplyAccess({
    slackChannelId: thread.slackChannelId,
    conversationOwnerUserId: thread.agentUserId,
    senderUserId: args.senderNuphosUserId,
    senderIsTeamMember: !!membership,
  })

  if (!access.allowed) {
    await postSenderNotice(
      args.runtime,
      args.channelId,
      args.threadTs,
      args.senderSlackUserId,
      access.reason === 'dm_recipient_only'
        ? 'This incident DM can only be continued by its intended Nuphos recipient.'
        : "Your Slack identity is no longer a member of this Nuphos team, so I can't act on your reply.",
    )
    await markSlackEvent(args.eventId, 'completed')

    return false
  }

  return true
}
