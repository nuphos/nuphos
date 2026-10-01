import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { getJoinedSlackChannel, isSlackChannelMember } from './destinations'
import { getSlackBindingByWorkspaceId, resolveInstalledWorkspaceBot } from './installations'
import { resolveSlackSelfMapping } from './self-mapping'

export type ChannelMappingAuthorizationDependencies = {
  getInstallationTeamId: (slackWorkspaceId: string) => Promise<string | null>
  resolveWorkspaceBot: (slackWorkspaceId: string) => Promise<{ botToken: string } | null>
  getMembership: (userId: string, teamId: string) => Promise<{ role?: string | null } | null>
  getSelfSlackUserId: (input: {
    botToken: string
    slackWorkspaceId: string
    teamId: string
    nuphosUserId: string
  }) => Promise<string | null>
  assertBotInChannel: (botToken: string, channelId: string) => Promise<unknown>
  isChannelMember: (botToken: string, channelId: string, slackUserId: string) => Promise<boolean>
  legacyBotConfigured: () => boolean
}

const defaultDependencies: ChannelMappingAuthorizationDependencies = {
  getInstallationTeamId: async (slackWorkspaceId) =>
    (await getSlackBindingByWorkspaceId(slackWorkspaceId))?.nuphosTeamId.toHexString() ?? null,
  resolveWorkspaceBot: resolveInstalledWorkspaceBot,
  getMembership: async (userId, teamId) => {
    const { getTeamMembership } = await import('@/lib/identity')

    return await getTeamMembership(userId, teamId)
  },
  getSelfSlackUserId: async (input) =>
    (
      await resolveSlackSelfMapping({
        botToken: input.botToken,
        slackWorkspaceId: input.slackWorkspaceId,
        teamId: input.teamId,
        nuphosUserId: input.nuphosUserId,
      })
    )?.slackUserId ?? null,
  assertBotInChannel: getJoinedSlackChannel,
  isChannelMember: isSlackChannelMember,
  legacyBotConfigured: () => Boolean(config.slack.botToken),
}

/**
 * Two-sided consent for creating/updating a channel mapping. The caller is
 * already verified as an administrator of the TARGET team; this asserts
 * authority over the CHANNEL side. A mapping is the grant that routes the
 * channel's messages to the team AND lets the team post there with the
 * workspace's bot, so team-side admin rights alone must never be enough:
 *
 * - Workspace installed by the same team: nothing more to prove.
 * - Workspace installed by another team: the caller must be an administrator
 *   of the installing team, OR their linked Slack identity must currently be
 *   a member of that exact channel (and the bot must be able to reach it).
 * - Workspace not installed: rejected — except when only the legacy shared
 *   bot is configured, which predates per-workspace installations and keeps
 *   its historical (weaker) trust model.
 */
export async function assertChannelMappingCreationAllowed(
  input: {
    teamId: string
    userId: string
    slackWorkspaceId: string
    slackChannelId: string
  },
  dependencies: ChannelMappingAuthorizationDependencies = defaultDependencies,
): Promise<void> {
  const installationTeamId = await dependencies.getInstallationTeamId(input.slackWorkspaceId)

  if (!installationTeamId) {
    if (dependencies.legacyBotConfigured()) return
    throw new AppError(
      400,
      'slack_workspace_not_installed',
      'That Slack workspace has no Nuphos installation, so its channels cannot be linked',
    )
  }
  if (installationTeamId === input.teamId) return

  const ownerRole = (await dependencies.getMembership(input.userId, installationTeamId))?.role

  if (ownerRole === 'ADMINISTRATOR') return

  const bot = await dependencies.resolveWorkspaceBot(input.slackWorkspaceId)

  if (!bot) {
    throw new AppError(
      400,
      'slack_workspace_not_installed',
      'That Slack workspace has no Nuphos installation, so its channels cannot be linked',
    )
  }
  await dependencies.assertBotInChannel(bot.botToken, input.slackChannelId)
  const selfSlackUserId = await dependencies.getSelfSlackUserId({
    botToken: bot.botToken,
    slackWorkspaceId: input.slackWorkspaceId,
    teamId: input.teamId,
    nuphosUserId: input.userId,
  })

  if (
    !selfSlackUserId ||
    !(await dependencies.isChannelMember(bot.botToken, input.slackChannelId, selfSlackUserId))
  ) {
    throw new AppError(
      403,
      'slack_channel_membership_required',
      "Linking a channel served by another team's installation requires your linked Slack account to be a member of that channel, or being an administrator of the installing team",
    )
  }
}
