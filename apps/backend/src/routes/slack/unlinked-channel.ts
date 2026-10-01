import { getCrossWorkspaceChannelMapping, markSlackEvent } from '@/lib/slack/agent-bot'
import { postSlackMessage, slackApiGet } from '@/lib/slack/api'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { linkChannelPromptBlocks } from '@/lib/slack/onboarding'
import { postThreadMessage } from '@/routes/slack/shared'

import type { SlackRuntime } from '@/routes/slack/types'

// A mention in a channel with no mapping for this workspace: either point at
// the other workspace's bot already serving the channel, or offer one-click
// linking. Always marks the event; the mention handler is done afterwards.
export async function handleUnmappedChannelMention(args: {
  runtime: SlackRuntime
  slackWorkspaceId: string
  channelId: string
  slackThreadTs: string
  eventId: string
}): Promise<void> {
  const { runtime, channelId, slackThreadTs, eventId } = args
  // Shared (Slack Connect) channel already served by another workspace's
  // installation: point the user at that bot instead of offering to link.
  // The other mapping only shapes this reply — execution context always
  // stays with the installation the event arrived through.
  const crossMapping = await getCrossWorkspaceChannelMapping(channelId, args.slackWorkspaceId)

  if (crossMapping) {
    const other = await resolveSlackBotForWorkspace(crossMapping.slackWorkspaceId)

    if (other?.botUserId) {
      let otherBotInChannel = false

      try {
        const info = await slackApiGet(other.botToken, 'conversations.info', {
          channel: channelId,
        })
        const channel = info.channel

        otherBotInChannel = !!(channel && typeof channel === 'object' && channel.is_member === true)
      } catch {
        // Non-fatal: fall back to the invite wording.
      }
      await postThreadMessage(
        runtime,
        channelId,
        slackThreadTs,
        otherBotInChannel
          ? `This channel is already linked to Nuphos through another workspace — mention <@${other.botUserId}> instead.`
          : `This channel is already linked to Nuphos through another workspace, but its bot isn't here yet — run \`/invite <@${other.botUserId}>\` first, then mention it.`,
      )
      await markSlackEvent(eventId, 'completed')

      return
    }
  }
  // Offer one-click linking instead of a dead end. The button carries the
  // channel id and routes through the same administrator gate as the DM
  // channel picker.
  let isExtShared = false

  try {
    const info = await slackApiGet(runtime.botToken, 'conversations.info', {
      channel: channelId,
    })
    const channel = info.channel

    isExtShared = !!(channel && typeof channel === 'object' && channel.is_ext_shared === true)
  } catch {
    // Non-fatal: the prompt just omits the external-visibility warning.
  }
  await postSlackMessage({
    token: runtime.botToken,
    channel: channelId,
    threadTs: slackThreadTs,
    text: "This channel isn't linked to Nuphos yet. A team administrator can link it with the button below, or pick channels from my DM.",
    blocks: linkChannelPromptBlocks({ channelId, isExtShared }),
  })
  await markSlackEvent(eventId, 'completed')
}
