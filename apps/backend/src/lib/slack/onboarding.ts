import { logEvent } from '@/lib/observability'
import { upsertSlackChannelMapping, upsertSlackUserMapping } from '@/lib/slack/agent-bot'
import { openSlackDm, postSlackMessage, slackApiGet } from '@/lib/slack/api'

import type { ObjectId } from 'mongodb'

function onboardingBlocks(): unknown[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Welcome to Nuphos Agent!*\nPick a Slack channel where your team can @mention me. I will reply in threads and act on behalf of whoever mentions me.',
      },
    },
    {
      type: 'actions',
      block_id: 'nuphos_onboarding',
      elements: [
        {
          type: 'conversations_select',
          action_id: 'nuphos_link_channel',
          placeholder: { type: 'plain_text', text: 'Select a channel' },
          filter: { include: ['public', 'private'] },
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Private channels only work after you `/invite @Nuphos` there first.',
        },
      ],
    },
  ]
}

export type ChannelAnnouncement = 'posted' | 'not_in_channel' | 'failed'

function announcementNote(channelId: string, outcome: ChannelAnnouncement): string {
  switch (outcome) {
    case 'posted':
      return `I said hello in <#${channelId}> — @mention me there to start.`
    case 'not_in_channel':
      // The bot holds no channels:join scope, so it cannot add itself; an
      // invite is the only way in, for public channels as much as private.
      return `Invite me with \`/invite @Nuphos\` in <#${channelId}> so I can see and answer mentions there.`
    case 'failed':
      return `@mention me in <#${channelId}> to start. (I couldn't post an intro there just now.)`
  }
}

function linkedChannelBlocks(
  channelId: string,
  channelName?: string,
  announcement: ChannelAnnouncement = 'failed',
): unknown[] {
  const label = channelName ? `#${channelName}` : `<#${channelId}>`

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Channel linked:* ${label}\n${announcementNote(channelId, announcement)} You can link more channels below.`,
      },
    },
    {
      type: 'actions',
      block_id: 'nuphos_onboarding',
      elements: [
        {
          type: 'conversations_select',
          action_id: 'nuphos_link_channel',
          placeholder: { type: 'plain_text', text: 'Link another channel' },
          filter: { include: ['public', 'private'] },
        },
      ],
    },
  ]
}

export async function autoLinkInstaller(args: {
  slackWorkspaceId: string
  teamId: string
  installerSlackUserId: string | null
  requesterNuphosUserId: string
}): Promise<void> {
  if (!args.installerSlackUserId) return
  await upsertSlackUserMapping({
    slackWorkspaceId: args.slackWorkspaceId,
    slackUserId: args.installerSlackUserId,
    teamId: args.teamId,
    nuphosUserId: args.requesterNuphosUserId,
    createdBy: args.requesterNuphosUserId,
    enabled: true,
  })
}

export async function sendSlackInstallWelcomeDm(args: {
  botToken: string
  installerSlackUserId: string
  slackTeamName: string
}): Promise<void> {
  const dmChannelId = await openSlackDm(args.botToken, args.installerSlackUserId)

  await postSlackMessage({
    token: args.botToken,
    channel: dmChannelId,
    text: `Nuphos is connected to ${args.slackTeamName}. Pick a channel below to get started.`,
    blocks: onboardingBlocks(),
  })
}

// Posted into a channel when the bot is mentioned there before the channel is
// linked. The button routes through the same interaction handler (and the same
// administrator gate) as the DM channel picker.
export function linkChannelPromptBlocks(args: {
  channelId: string
  isExtShared: boolean
}): unknown[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `This channel isn't linked to Nuphos yet. A team administrator can link <#${args.channelId}> with the button below — then mention me again.`,
      },
    },
    ...(args.isExtShared
      ? [
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '⚠️ This channel is shared with external organizations — once linked, my replies here are visible to them.',
              },
            ],
          },
        ]
      : []),
    {
      type: 'actions',
      block_id: 'nuphos_link_channel_prompt',
      elements: [
        {
          type: 'button',
          style: 'primary',
          action_id: 'nuphos_link_channel',
          text: { type: 'plain_text', text: 'Link this channel' },
          value: args.channelId,
        },
      ],
    },
  ]
}

export async function linkChannelFromSlackInteraction(args: {
  botToken: string
  slackWorkspaceId: string
  nuphosTeamId: string
  channelId: string
  linkedBySlackUserId: string
  linkedByNuphosUserId?: string
}): Promise<{ channelName: string | null }> {
  // Verify the bot can actually see the channel before persisting the mapping.
  // For a private channel the bot has not been invited to, conversations.info
  // fails — surfacing that lets the caller tell the user to /invite the bot
  // instead of silently storing a mapping that will never receive events.
  const info = await slackApiGet(args.botToken, 'conversations.info', { channel: args.channelId })
  const channel = info.channel
  const channelName =
    channel && typeof channel === 'object' && typeof channel.name === 'string' ? channel.name : null

  await upsertSlackChannelMapping({
    slackWorkspaceId: args.slackWorkspaceId,
    slackChannelId: args.channelId,
    teamId: args.nuphosTeamId,
    createdBy: args.linkedByNuphosUserId ?? args.linkedBySlackUserId,
    enabled: true,
  })

  logEvent('info', 'slack.onboarding.channel_linked', {
    team_id: args.nuphosTeamId,
    slack_workspace_id: args.slackWorkspaceId,
    slack_channel_id: args.channelId,
    linked_by_slack_user_id: args.linkedBySlackUserId,
  })

  return { channelName }
}

export function buildChannelLinkedInteractionResponse(args: {
  channelId: string
  channelName: string | null
  announcement?: ChannelAnnouncement
}): Record<string, unknown> {
  return {
    replace_original: true,
    blocks: linkedChannelBlocks(args.channelId, args.channelName ?? undefined, args.announcement),
  }
}

/**
 * Says hello in a channel the moment it is linked, so the link is visible to
 * everyone in it rather than only to whoever clicked in the DM — and so a
 * missing invite is discovered now instead of the first time someone mentions
 * the bot and gets silence.
 *
 * Never throws: the mapping is already stored and the DM confirmation reports
 * whichever outcome this returns.
 */
export async function announceChannelLink(args: {
  botToken: string
  channelId: string
}): Promise<ChannelAnnouncement> {
  try {
    await postSlackMessage({
      token: args.botToken,
      channel: args.channelId,
      text: "👋 Nuphos is now linked to this channel. @mention me and I'll pick it up in a thread — I act on behalf of whoever mentions me.",
    })

    return 'posted'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const outcome: ChannelAnnouncement = message.includes('not_in_channel')
      ? 'not_in_channel'
      : 'failed'

    logEvent('info', 'slack.onboarding.channel_announce_skipped', {
      slack_channel_id: args.channelId,
      outcome,
      error: message,
    })

    return outcome
  }
}

export async function resolveNuphosUserForSlackActor(args: {
  slackWorkspaceId: string
  nuphosTeamId: ObjectId
  slackUserId: string
}): Promise<string | null> {
  const { getSlackUserMapping } = await import('@/lib/slack/agent-bot')
  const existing = await getSlackUserMapping(
    args.slackWorkspaceId,
    args.nuphosTeamId.toHexString(),
    args.slackUserId,
  )

  return existing?.nuphosUserId ?? null
}
