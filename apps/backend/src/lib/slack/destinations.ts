import { AppError } from '@/lib/errors'

import { slackApiGet } from './api'

type SlackApiGet = typeof slackApiGet

export type SlackJoinedChannel = {
  id: string
  name: string
  isPrivate: boolean
}

/**
 * User-approved destination persisted on monitoring triggers. slackWorkspaceId
 * disambiguates channels reached through a cross-workspace channel grant;
 * destinations stored before it existed omit it and resolve first-party-first.
 */
export type SlackOutboundDestination =
  { type: 'channel'; channelId: string; slackWorkspaceId?: string } | { type: 'dm_self' }

/** Private destination metadata is visible only to authorized callers. */
export function filterVisibleSlackChannels<T extends SlackJoinedChannel>(
  channels: T[],
  canViewPrivateChannels: boolean,
): T[] {
  return channels.filter((channel) => !channel.isPrivate || canViewPrivateChannels)
}

/**
 * List only channels the installed bot has joined. Public channels visible to
 * the token but not joined are deliberately excluded: chat:write does not let
 * this app post there, and presenting them as notification destinations would
 * turn a predictable setup step into a late trigger-time failure.
 */
export async function listJoinedSlackChannels(
  token: string,
  apiGet: SlackApiGet = slackApiGet,
): Promise<SlackJoinedChannel[]> {
  const channels: SlackJoinedChannel[] = []
  let cursor: string | undefined
  const seenCursors = new Set<string>()

  while (true) {
    const json = await apiGet(token, 'conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: 200,
      ...(cursor ? { cursor } : {}),
    })

    for (const channel of json.channels ?? []) {
      if (
        !channel.id ||
        !channel.name ||
        channel.is_archived === true ||
        channel.is_member !== true
      ) {
        continue
      }
      channels.push({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private === true,
      })
    }
    cursor = json.response_metadata?.next_cursor?.trim()
    if (!cursor) break
    if (seenCursors.has(cursor)) {
      throw new AppError(502, 'slack_api_error', 'Slack returned a repeated pagination cursor')
    }
    seenCursors.add(cursor)
  }
  channels.sort((a, b) => a.name.localeCompare(b.name))

  return channels
}

/**
 * Channel metadata without the joined-membership requirement — for settings
 * surfaces that must describe a mapping even when the bot has left. Returns
 * null when Slack cannot see the channel at all (e.g. a private channel the
 * bot was removed from).
 */
export async function describeSlackChannel(
  token: string,
  channelId: string,
  apiGet: SlackApiGet = slackApiGet,
): Promise<{
  id: string
  name: string
  isPrivate: boolean
  isMember: boolean
  isArchived: boolean
} | null> {
  try {
    const json = await apiGet(token, 'conversations.info', { channel: channelId })
    const channel = json.channel

    if (!channel || typeof channel !== 'object' || !channel.id) return null

    return {
      id: channel.id,
      name: channel.name ?? channel.id,
      isPrivate: channel.is_private === true,
      isMember: channel.is_member === true,
      isArchived: channel.is_archived === true,
    }
  } catch {
    return null
  }
}

/** Whether a Slack user is currently a member of a channel the bot can read. */
export async function isSlackChannelMember(
  token: string,
  channelId: string,
  slackUserId: string,
  apiGet: SlackApiGet = slackApiGet,
): Promise<boolean> {
  let cursor: string | undefined
  const seenCursors = new Set<string>()

  while (true) {
    const json = await apiGet(token, 'conversations.members', {
      channel: channelId,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    })

    if ((json.members ?? []).includes(slackUserId)) return true
    cursor = json.response_metadata?.next_cursor?.trim()
    if (!cursor) return false
    if (seenCursors.has(cursor)) {
      throw new AppError(502, 'slack_api_error', 'Slack returned a repeated pagination cursor')
    }
    seenCursors.add(cursor)
  }
}

/** Revalidate membership at send time so a stale picker/template cannot post. */
export async function getJoinedSlackChannel(
  token: string,
  channelId: string,
  apiGet: SlackApiGet = slackApiGet,
): Promise<SlackJoinedChannel> {
  const json = await apiGet(token, 'conversations.info', { channel: channelId })
  const channel = json.channel

  if (!channel || typeof channel !== 'object') {
    throw new AppError(400, 'slack_channel_unavailable', 'Slack did not return that channel')
  }
  if (channel.is_archived === true) {
    throw new AppError(400, 'slack_channel_unavailable', 'That Slack channel is archived')
  }
  if (channel.is_member !== true) {
    throw new AppError(
      400,
      'slack_not_in_channel',
      'Nuphos is not in that Slack channel. Invite the Nuphos bot there first.',
    )
  }
  if (!channel.id) {
    throw new AppError(502, 'slack_api_error', 'Slack did not return a channel id')
  }

  return {
    id: channel.id,
    name: channel.name ?? channel.id,
    isPrivate: channel.is_private === true,
  }
}
