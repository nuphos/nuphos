import type { SlackOutboundDependencies, SlackTeamAccess } from '@/lib/slack/agent-outbound/types'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'

export type SlackDestinationRoute =
  { ok: true; sendToken: string; sendWorkspaceId: string } | { ok: false; error: string }

// Route the destination to a workspace + bot. First-party wins for its
// own workspace; anything else must be an explicitly granted channel.
export async function routeSlackDestination(input: {
  dependencies: SlackOutboundDependencies
  access: SlackTeamAccess
  destination: SlackOutboundDestination
}): Promise<SlackDestinationRoute> {
  const { dependencies, access, destination } = input

  if (destination.type === 'dm_self') {
    if (!access.installation) {
      return {
        ok: false,
        error:
          'Slack DM is unavailable: this team has channel-scoped Slack access through linked channels, not a workspace connection of its own.',
      }
    }

    return {
      ok: true,
      sendToken: access.installation.botToken,
      sendWorkspaceId: access.installation.workspaceId,
    }
  }
  const targetChannelId = destination.channelId
  const requestedWorkspaceId = destination.slackWorkspaceId
  const grant = access.grants.find((entry) =>
    requestedWorkspaceId
      ? entry.workspaceId === requestedWorkspaceId && entry.channelIds.has(targetChannelId)
      : entry.channelIds.has(targetChannelId),
  )
  const notLinked = (): SlackDestinationRoute => ({
    ok: false,
    error:
      'That Slack channel is not linked to this Nuphos team. Only channels explicitly linked to the team are valid destinations.',
  })
  // The team's own bot is the right sender either when the caller named
  // its workspace, or when no grant covers the channel.
  const ownWorkspace = requestedWorkspaceId
    ? access.installation?.workspaceId === requestedWorkspaceId
    : !grant

  if (access.installation && ownWorkspace) {
    return {
      ok: true,
      sendToken: access.installation.botToken,
      sendWorkspaceId: access.installation.workspaceId,
    }
  }
  if (requestedWorkspaceId) {
    if (!grant) return notLinked()

    return { ok: true, sendToken: grant.botToken, sendWorkspaceId: grant.workspaceId }
  }
  if (access.installation && grant) {
    // A Slack Connect channel keeps one id in every workspace: prefer
    // the team's own bot when it can reach the channel, otherwise use
    // the grant.
    try {
      await dependencies.getChannel(access.installation.botToken, targetChannelId)

      return {
        ok: true,
        sendToken: access.installation.botToken,
        sendWorkspaceId: access.installation.workspaceId,
      }
    } catch {
      return { ok: true, sendToken: grant.botToken, sendWorkspaceId: grant.workspaceId }
    }
  }
  if (grant) {
    return { ok: true, sendToken: grant.botToken, sendWorkspaceId: grant.workspaceId }
  }

  return notLinked()
}
