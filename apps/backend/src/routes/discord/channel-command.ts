import { mongo } from '@/lib/db'
import { DiscordApiError, getDiscordChannel } from '@/lib/discord/api'
import {
  discordChannelMappings,
  discordInstallations,
  discordUserMappings,
} from '@/lib/discord/store'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

import { markDiscordApprovalsRejected, resolveInvalidatedDiscordApprovals } from './approval'

import type { DiscordDecision } from '@/lib/discord/store'
import type { ClientSession } from 'mongodb'

export type DiscordChannelCommand = 'enable' | 'disable'

export type DiscordCommandInteraction = {
  guild_id?: string
  channel_id?: string
  member?: { permissions?: string; user?: { id: string } }
  data?: { name?: string; options?: { type?: number; name?: string }[] }
}

type Installation = { teamId: string }
type UserMapping = { nuphosUserId: string }

export type DiscordChannelCommandDependencies = {
  findInstallation: (guildId: string) => Promise<Installation | null>
  findUserMapping: (args: {
    guildId: string
    teamId: string
    discordUserId: string
  }) => Promise<UserMapping | null>
  findMembership: (userId: string, teamId: string) => Promise<{ role: string } | null>
  getChannel: (channelId: string) => Promise<{
    id: string
    type: number
    guild_id?: string
    parent_id?: string
  } | null>
  enableChannel: (args: {
    teamId: string
    guildId: string
    channelId: string
    nuphosUserId: string
  }) => Promise<void>
  disableChannel: (args: { teamId: string; guildId: string; channelId: string }) => Promise<void>
}

type DisableChannelArgs = { teamId: string; guildId: string; channelId: string }

export type DisableDiscordChannelDependencies = {
  runTransaction: (callback: (session: unknown) => Promise<void>) => Promise<void>
  disableMapping: (args: DisableChannelArgs, session: unknown) => Promise<void>
  rejectApprovals: (args: DisableChannelArgs, session: unknown) => Promise<DiscordDecision[]>
  resolveApprovals: (decisions: DiscordDecision[], reason: string) => Promise<void>
}

const MANAGE_CHANNELS = 1n << 4n
const ADMINISTRATOR = 1n << 3n

export function parseDiscordChannelCommand(
  interaction: DiscordCommandInteraction,
): DiscordChannelCommand | null {
  if (interaction.data?.name !== 'nuphos') return null
  const option = interaction.data.options?.find((entry) => entry.type === 1)

  return option?.name === 'enable' || option?.name === 'disable' ? option.name : null
}

export function canManageDiscordChannel(permissions?: string): boolean {
  if (!permissions) return false

  try {
    const bits = BigInt(permissions)

    return (bits & MANAGE_CHANNELS) === MANAGE_CHANNELS || (bits & ADMINISTRATOR) === ADMINISTRATOR
  } catch {
    return false
  }
}

const defaultDisableDependencies: DisableDiscordChannelDependencies = {
  runTransaction: async (callback) => {
    const session = mongo.startSession()

    try {
      await session.withTransaction(async () => {
        await callback(session)
      })
    } finally {
      await session.endSession()
    }
  },
  disableMapping: async ({ teamId, guildId, channelId }, session) => {
    await discordChannelMappings().updateOne(
      { teamId, guildId, channelId },
      { $set: { enabled: false, updatedAt: new Date() } },
      { session: session as ClientSession },
    )
  },
  rejectApprovals: async ({ teamId, guildId, channelId }, session) =>
    await markDiscordApprovalsRejected(
      { teamId, guildId, parentChannelId: channelId },
      session as ClientSession,
    ),
  resolveApprovals: resolveInvalidatedDiscordApprovals,
}

export async function disableDiscordChannel(
  args: DisableChannelArgs,
  dependencies: DisableDiscordChannelDependencies = defaultDisableDependencies,
): Promise<void> {
  let decisions: DiscordDecision[] = []

  await dependencies.runTransaction(async (session) => {
    await dependencies.disableMapping(args, session)
    decisions = await dependencies.rejectApprovals(args, session)
  })
  await dependencies.resolveApprovals(decisions, 'discord_channel_disabled')
}

const defaultDependencies: DiscordChannelCommandDependencies = {
  findInstallation: async (guildId) =>
    await discordInstallations().findOne({ guildId, enabled: true }),
  findUserMapping: async ({ guildId, teamId, discordUserId }) =>
    await discordUserMappings().findOne({ guildId, teamId, discordUserId, enabled: true }),
  findMembership: getTeamMembership,
  getChannel: getDiscordChannel,
  enableChannel: async ({ teamId, guildId, channelId, nuphosUserId }) => {
    const now = new Date()

    await discordChannelMappings().updateOne(
      { guildId, channelId },
      {
        $setOnInsert: { teamId, createdBy: nuphosUserId, createdAt: now },
        $set: { enabled: true, updatedAt: now },
      },
      { upsert: true },
    )
  },
  disableChannel: disableDiscordChannel,
}

export async function handleDiscordChannelCommand(
  interaction: DiscordCommandInteraction,
  dependencies: DiscordChannelCommandDependencies = defaultDependencies,
): Promise<string> {
  const command = parseDiscordChannelCommand(interaction)
  const guildId = interaction.guild_id
  const sourceChannelId = interaction.channel_id
  const discordUserId = interaction.member?.user?.id

  if (!command || !guildId || !sourceChannelId || !discordUserId) {
    return 'This command is only available inside a Discord server channel.'
  }
  if (!canManageDiscordChannel(interaction.member?.permissions)) {
    return 'You need the Discord Manage Channels permission to change Nuphos access here.'
  }
  const installation = await dependencies.findInstallation(guildId)

  if (!installation) return 'This server is not connected to a Nuphos workspace.'
  const userMapping = await dependencies.findUserMapping({
    guildId,
    teamId: installation.teamId,
    discordUserId,
  })
  const membership = userMapping
    ? await dependencies.findMembership(userMapping.nuphosUserId, installation.teamId)
    : null

  if (!userMapping || membership?.role !== 'ADMINISTRATOR') {
    return 'Only a linked Nuphos workspace administrator can change channel access.'
  }
  let channel: Awaited<ReturnType<DiscordChannelCommandDependencies['getChannel']>>

  try {
    channel = await dependencies.getChannel(sourceChannelId)
  } catch (error) {
    logEvent('warn', 'discord.channel.verification_failed', {
      team_id: installation.teamId,
      discord_guild_id: guildId,
      discord_channel_id: sourceChannelId,
      status: error instanceof DiscordApiError ? error.status : undefined,
      discord_error_code: error instanceof DiscordApiError ? error.code : undefined,
    })
    if (error instanceof DiscordApiError && error.status === 403) {
      return 'Nuphos cannot access this channel. In Discord, open Edit Channel → Permissions, add the Nuphos bot, and allow View Channel, Send Messages, Read Message History, Create Public Threads, and Send Messages in Threads. For a private thread, also invite Nuphos to the thread. Then retry this command. /nuphos enable does not change Discord permissions.'
    }
    if (error instanceof DiscordApiError && error.status === 404) {
      return 'Discord could not find this channel. Open an existing server channel and retry the command.'
    }

    return 'Discord is temporarily unable to verify this channel. Please try again shortly.'
  }

  if (!channel || channel.guild_id !== guildId) return 'Discord could not verify this channel.'
  const isThread = channel.type === 10 || channel.type === 11 || channel.type === 12
  const channelId = isThread ? channel.parent_id : channel.id

  if (!channelId) return 'Discord could not identify this thread’s parent channel.'
  if (command === 'enable') {
    await dependencies.enableChannel({
      teamId: installation.teamId,
      guildId,
      channelId,
      nuphosUserId: userMapping.nuphosUserId,
    })
  } else {
    await dependencies.disableChannel({ teamId: installation.teamId, guildId, channelId })
  }
  logEvent('info', `discord.channel.${command}d`, {
    team_id: installation.teamId,
    discord_guild_id: guildId,
    discord_channel_id: channelId,
    discord_user_id: discordUserId,
    nuphos_user_id: userMapping.nuphosUserId,
  })

  return command === 'enable'
    ? '✅ Nuphos is enabled in this channel. Linked workspace members can now mention @Nuphos.'
    : '⛔ Nuphos is disabled in this channel.'
}
