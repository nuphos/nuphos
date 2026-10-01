import type { SlackAgentThread } from '@/lib/slack/agent-bot'

export type SlackThreadReplyAccess =
  { allowed: true } | { allowed: false; reason: 'not_team_member' | 'dm_recipient_only' }

/**
 * Proactive channel notifications are team collaboration surfaces: any
 * currently-linked Nuphos teammate may continue the bound incident. A 1:1
 * Slack DM is different — only the conversation owner/recipient may drive it.
 *
 * The workspace/team binding and Slack identity mapping are verified by the
 * caller before this policy runs. `senderIsTeamMember` is deliberately an
 * explicit input so stale Slack user mappings cannot grant access.
 */
export function getAgentNotificationReplyAccess(args: {
  slackChannelId: string
  conversationOwnerUserId: string
  senderUserId: string
  senderIsTeamMember: boolean
}): SlackThreadReplyAccess {
  if (!args.senderIsTeamMember) {
    return { allowed: false, reason: 'not_team_member' }
  }

  if (args.slackChannelId.startsWith('D') && args.senderUserId !== args.conversationOwnerUserId) {
    return { allowed: false, reason: 'dm_recipient_only' }
  }

  return { allowed: true }
}

/**
 * A shared Slack thread keeps writing to its original Nuphos conversation,
 * while every turn executes as the teammate who actually sent the reply.
 */
export function getSlackThreadTurnIdentity(
  thread: Pick<SlackAgentThread, 'agentUserId'>,
  senderUserId: string,
): { conversationOwnerUserId: string; actorUserId: string } {
  return {
    conversationOwnerUserId: thread.agentUserId,
    actorUserId: senderUserId,
  }
}
