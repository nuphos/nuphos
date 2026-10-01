import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { listSlackChannelMappings } from '@/lib/slack/agent-bot'
import { getJoinedSlackChannel } from '@/lib/slack/destinations'
import {
  getSlackBindingForTeam,
  resolveInstalledWorkspaceBot,
  resolveSlackBotForTeam,
} from '@/lib/slack/installations'
import { resolveSlackSelfMapping } from '@/lib/slack/self-mapping'

import type { SlackOutboundDestination } from '@/lib/slack/destinations'

export type TriggerSlackAuthorizationDependencies = {
  getBinding: typeof getSlackBindingForTeam
  resolveBot: typeof resolveSlackBotForTeam
  listChannelGrants: (
    teamId: string,
  ) => Promise<{ slackWorkspaceId: string; slackChannelId: string }[]>
  resolveWorkspaceBot: (
    slackWorkspaceId: string,
  ) => Promise<{ botToken: string; workspaceName: string } | null>
  getChannel: typeof getJoinedSlackChannel
  getSelfMapping: typeof resolveSlackSelfMapping
  getMembership: (userId: string, teamId: string) => Promise<{ role?: string | null } | null>
}

const defaultDependencies: TriggerSlackAuthorizationDependencies = {
  getBinding: getSlackBindingForTeam,
  resolveBot: resolveSlackBotForTeam,
  listChannelGrants: async (teamId) =>
    (await listSlackChannelMappings(teamId))
      .filter((mapping) => mapping.enabled)
      .map((mapping) => ({
        slackWorkspaceId: mapping.slackWorkspaceId,
        slackChannelId: mapping.slackChannelId,
      })),
  resolveWorkspaceBot: resolveInstalledWorkspaceBot,
  getChannel: getJoinedSlackChannel,
  getSelfMapping: resolveSlackSelfMapping,
  getMembership: async (userId, teamId) => {
    const { getTeamMembership } = await import('@/lib/identity')

    return await getTeamMembership(userId, teamId)
  },
}

/**
 * Turn the destination selected in the Watch dialog into a server-verified
 * authorization boundary before it is persisted on a trigger. The Slack API
 * is still consulted again at send time because membership and installations
 * can change after creation.
 */
export async function assertTriggerSlackDestinationAuthorized(
  destination: SlackOutboundDestination,
  context: { teamId?: string; userId: string },
  dependencies: TriggerSlackAuthorizationDependencies = defaultDependencies,
): Promise<void> {
  if (!context.teamId || !ObjectId.isValid(context.teamId)) {
    throw new AppError(
      400,
      'slack_team_required',
      'A valid Nuphos team is required for a Slack notification destination',
    )
  }

  const teamId = new ObjectId(context.teamId)
  const binding = await dependencies.getBinding(teamId)

  if (!binding) {
    // No installation of its own: a channel destination can still be
    // authorized through an enabled channel mapping granted to this team from
    // another workspace's installation. DM never rides a channel grant.
    if (destination.type !== 'channel') {
      throw new AppError(
        400,
        'slack_not_connected',
        'Slack DM requires this team to have its own Slack connection; this team only has channel-scoped Slack access',
      )
    }
    const granted = await assertGrantedChannelDestinationAuthorized(
      destination,
      context as { teamId: string; userId: string },
      dependencies,
    )

    if (!granted) {
      throw new AppError(
        400,
        'slack_not_connected',
        'Connect Slack to this Nuphos team — or link this channel to it — before creating a Slack notification trigger',
      )
    }

    return
  }
  const bot = await dependencies.resolveBot(teamId)

  if (!bot || bot.binding.slackTeamId !== binding.slackTeamId) {
    throw new AppError(400, 'slack_not_connected', 'Slack is not available for this Nuphos team')
  }

  if (destination.type === 'channel') {
    // A workspace-qualified destination outside the team's own workspace, or
    // a channel its own bot cannot reach, may still be authorized through a
    // channel grant from another workspace's installation.
    const wantsForeignWorkspace =
      !!destination.slackWorkspaceId && destination.slackWorkspaceId !== binding.slackTeamId

    if (!wantsForeignWorkspace) {
      try {
        await assertChannelDestinationAuthorized(
          destination,
          context as { teamId: string; userId: string },
          bot.botToken,
          dependencies,
        )

        return
      } catch (err) {
        const unreachable =
          err instanceof AppError &&
          (err.code === 'slack_not_in_channel' || err.code === 'slack_channel_unavailable')

        if (!unreachable) throw err
        const granted = await assertGrantedChannelDestinationAuthorized(
          destination,
          context as { teamId: string; userId: string },
          dependencies,
        )

        if (!granted) throw err

        return
      }
    }
    const granted = await assertGrantedChannelDestinationAuthorized(
      destination,
      context as { teamId: string; userId: string },
      dependencies,
    )

    if (!granted) {
      throw new AppError(
        400,
        'slack_not_connected',
        'That Slack channel is not linked to this Nuphos team',
      )
    }

    return
  }

  const mapping = await dependencies.getSelfMapping({
    botToken: bot.botToken,
    slackWorkspaceId: binding.slackTeamId,
    teamId: context.teamId,
    nuphosUserId: context.userId,
  })

  if (!mapping) {
    throw new AppError(
      400,
      'slack_self_not_linked',
      'Your Slack identity is not linked to this Nuphos team, so Slack DM is unavailable',
    )
  }
}

/**
 * Authorize a channel destination through a channel grant. Returns false when
 * no matching grant exists (the caller decides the error); throws when a grant
 * exists but its workspace or channel-level checks fail.
 */
async function assertGrantedChannelDestinationAuthorized(
  destination: { type: 'channel'; channelId: string; slackWorkspaceId?: string },
  context: { teamId: string; userId: string },
  dependencies: TriggerSlackAuthorizationDependencies,
): Promise<boolean> {
  const grants = await dependencies.listChannelGrants(context.teamId)
  const grant = grants.find(
    (entry) =>
      entry.slackChannelId === destination.channelId &&
      (!destination.slackWorkspaceId || entry.slackWorkspaceId === destination.slackWorkspaceId),
  )

  if (!grant) return false
  const workspaceBot = await dependencies.resolveWorkspaceBot(grant.slackWorkspaceId)

  if (!workspaceBot) {
    throw new AppError(
      400,
      'slack_not_connected',
      'The Slack workspace serving this linked channel is no longer installed',
    )
  }
  await assertChannelDestinationAuthorized(
    destination,
    context,
    workspaceBot.botToken,
    dependencies,
  )

  return true
}

async function assertChannelDestinationAuthorized(
  destination: { type: 'channel'; channelId: string },
  context: { teamId: string; userId: string },
  botToken: string,
  dependencies: TriggerSlackAuthorizationDependencies,
): Promise<void> {
  const channel = await dependencies.getChannel(botToken, destination.channelId)

  if (channel.id !== destination.channelId) {
    throw new AppError(
      400,
      'invalid_slack_destination',
      'Slack returned a different channel than the selected destination',
    )
  }
  if (channel.isPrivate) {
    const membership = await dependencies.getMembership(context.userId, context.teamId)

    if (membership?.role !== 'ADMINISTRATOR') {
      throw new AppError(
        403,
        'private_slack_destination_forbidden',
        'Only team administrators can create notifications for private Slack channels',
      )
    }
  }
}
