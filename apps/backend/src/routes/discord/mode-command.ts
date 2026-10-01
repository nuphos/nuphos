import { setSessionBypass } from '@/lib/agent/auto-mode/store'
import {
  discordAgentThreads,
  discordChannelMappings,
  discordInstallations,
  discordUserMappings,
} from '@/lib/discord/store'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

import type { DiscordCommandInteraction } from './channel-command'

const defaultDependencies = {
  setSessionBypass,
  discordAgentThreads,
  discordChannelMappings,
  discordInstallations,
  discordUserMappings,
  getTeamMembership,
}

export type DiscordModeDependencies = typeof defaultDependencies

export async function handleDiscordModeCommand(
  interaction: DiscordCommandInteraction,
  dependencies: DiscordModeDependencies = defaultDependencies,
): Promise<string | null> {
  const {
    setSessionBypass,
    discordAgentThreads,
    discordChannelMappings,
    discordInstallations,
    discordUserMappings,
    getTeamMembership,
  } = dependencies
  const command = interaction.data?.options?.find((option) => option.type === 1)?.name

  if (interaction.data?.name !== 'nuphos' || (command !== 'full-access' && command !== 'auto'))
    return null
  const guildId = interaction.guild_id
  const channelId = interaction.channel_id
  const discordUserId = interaction.member?.user?.id

  if (!guildId || !channelId || !discordUserId)
    return 'Use this command inside a Nuphos conversation thread.'
  const thread = await discordAgentThreads().findOne({ guildId, threadChannelId: channelId })

  if (!thread) return 'Use this command inside a Nuphos conversation thread.'
  const [installation, channel, mapping] = await Promise.all([
    discordInstallations().findOne({
      guildId,
      teamId: thread.teamId,
      generation: thread.generation,
      enabled: true,
    }),
    discordChannelMappings().findOne({
      guildId,
      channelId: thread.parentChannelId,
      teamId: thread.teamId,
      enabled: true,
    }),
    discordUserMappings().findOne({ guildId, discordUserId, teamId: thread.teamId, enabled: true }),
  ])

  if (!installation || !channel) return 'Nuphos is not enabled for this thread.'
  if (!mapping || !(await getTeamMembership(mapping.nuphosUserId, thread.teamId))) {
    return 'Link your Discord account to this Nuphos workspace first.'
  }
  // Permission grants are actor scoped: nobody can disarm a teammate's gate.
  await setSessionBypass(thread.sessionId, mapping.nuphosUserId, command === 'full-access')
  logEvent('info', 'discord.thread.permission_mode_changed', {
    team_id: thread.teamId,
    session_id: thread.sessionId,
    discord_guild_id: guildId,
    discord_channel_id: channelId,
    discord_user_id: discordUserId,
    nuphos_user_id: mapping.nuphosUserId,
    mode: command,
  })

  return command === 'full-access'
    ? 'Your turns in this thread now use Full Access.'
    : 'Your turns in this thread now use Auto Mode.'
}
