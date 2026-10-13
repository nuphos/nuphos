import { DiscordApiError, discordApi, getDiscordChannel } from '@/lib/discord/api'
import { discordChannelMappings, discordInstallations } from '@/lib/discord/store'
import { AppError } from '@/lib/errors'

import type { DiscordChannel } from '@/lib/discord/api'

// An agent reaches only the channels an administrator enabled for Nuphos and
// the threads under them.
const SNOWFLAKE = /^\d{5,20}$/u
// Announcement and public threads. A private thread (12) is invite-only in
// Discord, so enabling its parent channel does not open it to the team.
const isOpenThread = (channel: DiscordChannel) => channel.type === 10 || channel.type === 11

export type RawMessage = {
  id: string
  channel_id: string
  content?: string
  timestamp: string
  edited_timestamp?: string | null
  pinned?: boolean
  author?: { id: string; username?: string; global_name?: string | null; bot?: boolean }
  attachments?: { filename: string; url: string; content_type?: string }[]
  embeds?: {
    title?: string
    description?: string
    url?: string
    fields?: { name: string; value: string }[]
  }[]
  message_reference?: { message_id?: string }
  thread?: { id: string; name?: string }
  reactions?: { count: number; emoji: { name?: string | null } }[]
}

const some = <T>(items: T[] | undefined) => (items?.length ? items : undefined)

export function discordMessageView(message: RawMessage) {
  return {
    id: message.id,
    channelId: message.channel_id,
    author: {
      id: message.author?.id,
      name: message.author?.global_name ?? message.author?.username,
      ...(message.author?.bot ? { bot: true } : {}),
    },
    content: message.content ?? '',
    timestamp: message.timestamp,
    ...(message.edited_timestamp ? { editedTimestamp: message.edited_timestamp } : {}),
    ...(message.pinned ? { pinned: true } : {}),
    replyTo: message.message_reference?.message_id,
    thread: message.thread && { id: message.thread.id, name: message.thread.name },
    attachments: some(
      message.attachments?.map((file) => ({
        filename: file.filename,
        url: file.url,
        contentType: file.content_type,
      })),
    ),
    embeds: some(
      message.embeds?.map((embed) => ({
        title: embed.title,
        description: embed.description,
        url: embed.url,
        fields: some(embed.fields),
      })),
    ),
    reactions: some(
      message.reactions?.map((reaction) => ({ emoji: reaction.emoji.name, count: reaction.count })),
    ),
  }
}

/** Discord's own refusals are the caller's to read; anything else is upstream. */
export async function discord<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await discordApi<T>(path, init)
  } catch (err) {
    if (!(err instanceof DiscordApiError)) throw err
    throw new AppError(
      err.status === 403 || err.status === 404 ? err.status : 502,
      'discord_api_error',
      err.message,
    )
  }
}

export async function requireInstallation(teamId: string) {
  const installation = await discordInstallations().findOne({ teamId, enabled: true })

  if (!installation) {
    throw new AppError(409, 'discord_not_installed', 'Discord is not installed for this team')
  }

  return installation
}

export const enabledChannelIds = async (teamId: string, guildId: string) =>
  (await discordChannelMappings().find({ teamId, guildId, enabled: true }).toArray()).map(
    (mapping) => mapping.channelId,
  )

export type DiscordChannelScopeDependencies = {
  findInstallation: (teamId: string) => Promise<{ guildId: string } | null>
  getChannel: (channelId: string) => Promise<DiscordChannel>
  isEnabled: (teamId: string, guildId: string, channelId: string) => Promise<boolean>
}

const scopeDependencies: DiscordChannelScopeDependencies = {
  findInstallation: (teamId) => discordInstallations().findOne({ teamId, enabled: true }),
  getChannel: getDiscordChannel,
  isEnabled: async (teamId, guildId, channelId) =>
    (await discordChannelMappings().findOne({ teamId, guildId, channelId, enabled: true })) !==
    null,
}

/** The channel, only if it is an enabled channel of this team or a thread under one. */
export async function resolveDiscordChannel(
  teamId: string,
  channelId: string,
  dependencies: DiscordChannelScopeDependencies = scopeDependencies,
): Promise<{ guildId: string; channel: DiscordChannel }> {
  if (!SNOWFLAKE.test(channelId)) {
    throw new AppError(400, 'invalid_request', 'Invalid Discord channel id')
  }
  const installation = await dependencies.findInstallation(teamId)

  if (!installation) {
    throw new AppError(409, 'discord_not_installed', 'Discord is not installed for this team')
  }
  const channel = await dependencies.getChannel(channelId).catch(() => null)
  const parentId = channel && isOpenThread(channel) ? channel.parent_id : channel?.id

  if (
    !channel ||
    !parentId ||
    channel.guild_id !== installation.guildId ||
    !(await dependencies.isEnabled(teamId, installation.guildId, parentId))
  ) {
    throw new AppError(
      403,
      'discord_channel_not_enabled',
      'Nuphos is not enabled in that Discord channel',
    )
  }

  return { guildId: installation.guildId, channel }
}

export function snowflake(value: string | undefined, name: string): string | undefined {
  if (value !== undefined && !SNOWFLAKE.test(value)) {
    throw new AppError(400, 'invalid_request', `Invalid ${name}`)
  }

  return value
}

export function limitOf(value: string | undefined, max: number): number {
  const limit = Number(value ?? max)

  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new AppError(400, 'invalid_request', `limit must be between 1 and ${String(max)}`)
  }

  return limit
}

/** Search hits the team may see: enabled channels and the open threads under them. */
export function reachableDiscordMessages(
  found: { messages: RawMessage[][]; threads?: DiscordChannel[] },
  enabled: string[],
): RawMessage[] {
  const reachable = new Set([
    ...enabled,
    ...(found.threads ?? [])
      .filter(
        (thread) => isOpenThread(thread) && thread.parent_id && enabled.includes(thread.parent_id),
      )
      .map((thread) => thread.id),
  ])

  return found.messages.flat().filter((message) => reachable.has(message.channel_id))
}
