import { filterVisibleSlackChannels } from '@/lib/slack/destinations'

import type {
  SlackOutboundContext,
  SlackOutboundDependencies,
  SlackTeamAccess,
} from '@/lib/slack/agent-outbound/types'
import type { SlackJoinedChannel } from '@/lib/slack/destinations'

export function createListSlackDestinations(input: {
  dependencies: SlackOutboundDependencies
  userId: string
  teamId: string
  resolveAccess: () => Promise<SlackTeamAccess>
}): SlackOutboundContext['listDestinations'] {
  const { dependencies, userId, teamId, resolveAccess } = input

  return async () => {
    const access = await resolveAccess()
    const channels: (SlackJoinedChannel & {
      slackWorkspaceId: string
      slackWorkspaceName: string
    })[] = []
    let dmSelfAvailable = false

    if (access.installation) {
      const { workspaceId, workspaceName, botToken } = access.installation
      const [joined, selfMapping] = await Promise.all([
        dependencies.listChannels(botToken),
        dependencies.getSelfMapping(workspaceId, teamId, userId, botToken),
      ])

      dmSelfAvailable = selfMapping !== null
      channels.push(
        ...joined.map((channel) => ({
          ...channel,
          slackWorkspaceId: workspaceId,
          slackWorkspaceName: workspaceName,
        })),
      )
    }
    for (const grant of access.grants) {
      for (const channelId of [...grant.channelIds].sort((a, b) => a.localeCompare(b))) {
        try {
          const channel = await dependencies.getChannel(grant.botToken, channelId)

          channels.push({
            ...channel,
            slackWorkspaceId: grant.workspaceId,
            slackWorkspaceName: grant.workspaceName,
          })
        } catch {
          // The bot left the mapped channel (or it was archived): posting
          // there would fail, so it is not offered as a destination.
        }
      }
    }
    const canViewPrivateChannels = await dependencies.canViewPrivateChannels(userId, teamId)
    const primary = access.installation ?? access.grants[0]!

    return {
      ok: true,
      workspace: { id: primary.workspaceId, name: primary.workspaceName },
      channels: filterVisibleSlackChannels(channels, canViewPrivateChannels),
      // DMs ride the team's own installation; a channel grant does not
      // extend to messaging people.
      dmSelfAvailable,
    }
  }
}
