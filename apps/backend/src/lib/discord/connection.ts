import { isDiscordConfigured } from './oauth'
import { discordChannelMappings, discordInstallations, discordUserMappings } from './store'

/** Shared public view for the install dialog and connector inventory. */
export async function getDiscordConnection(teamId: string, userId: string) {
  const [installation, channels, self] = await Promise.all([
    discordInstallations().findOne({ teamId, enabled: true }),
    discordChannelMappings().find({ teamId, enabled: true }).toArray(),
    discordUserMappings().findOne({ teamId, nuphosUserId: userId, enabled: true }),
  ])

  return {
    configured: isDiscordConfigured(),
    installation: installation
      ? { guildId: installation.guildId, guildName: installation.guildName }
      : null,
    channels: installation ? channels.map((entry) => ({ channelId: entry.channelId })) : [],
    linkedDiscordUserId: installation ? (self?.discordUserId ?? null) : null,
  }
}
