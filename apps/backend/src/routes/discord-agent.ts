import { Hono } from 'hono'

import { splitDiscordText } from '@/lib/discord/api'
import { discordAgentThreads } from '@/lib/discord/store'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

import {
  discord,
  discordMessageView,
  enabledChannelIds,
  limitOf,
  reachableDiscordMessages,
  requireInstallation,
  resolveDiscordChannel,
  snowflake,
} from './discord/agent-access'

import type { RawMessage } from './discord/agent-access'
import type { DiscordChannel } from '@/lib/discord/api'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { ConversationTeamAuthVariables } from '@/routes/teams/conversation-auth'

// What an agent may do in the team's Discord server. The bot token stays here;
// agent-access confines every route to the channels enabled for Nuphos.
export const discordAgentRoutes = new Hono<{
  Variables: TeamAuthVariables & ConversationTeamAuthVariables
}>()

// Where this conversation lives in Discord, and which channels it may reach.
discordAgentRoutes.get('/', async (c) => {
  const teamId = c.get('teamId')
  const installation = await requireInstallation(teamId)
  const sessionId = c.get('conversationAgent')?.sessionId
  const [enabled, guildChannels, thread] = await Promise.all([
    enabledChannelIds(teamId, installation.guildId),
    discord<DiscordChannel[]>(`/guilds/${installation.guildId}/channels`),
    sessionId ? discordAgentThreads().findOne({ teamId, sessionId }) : null,
  ])

  return c.json({
    guild: { id: installation.guildId, name: installation.guildName },
    channels: guildChannels
      .filter((channel) => enabled.includes(channel.id))
      .map((channel) => ({ id: channel.id, name: channel.name, topic: channel.topic })),
    thread: thread && {
      channelId: thread.threadChannelId,
      parentChannelId: thread.parentChannelId,
      rootMessageId: thread.rootMessageId,
    },
  })
})

discordAgentRoutes.get('/channels/:channelId/messages', async (c) => {
  const { channel } = await resolveDiscordChannel(c.get('teamId'), c.req.param('channelId'))
  const query = new URLSearchParams({ limit: String(limitOf(c.req.query('limit'), 100)) })

  for (const key of ['before', 'after', 'around'] as const) {
    const value = snowflake(c.req.query(key), key)

    if (value) query.set(key, value)
  }
  const messages = await discord<RawMessage[]>(
    `/channels/${channel.id}/messages?${query.toString()}`,
  )

  // Discord answers newest first; a transcript reads oldest first.
  return c.json({ messages: messages.map(discordMessageView).reverse() })
})

discordAgentRoutes.get('/channels/:channelId/messages/:messageId', async (c) => {
  const { channel } = await resolveDiscordChannel(c.get('teamId'), c.req.param('channelId'))
  const messageId = snowflake(c.req.param('messageId'), 'messageId')

  return c.json(
    discordMessageView(
      await discord<RawMessage>(`/channels/${channel.id}/messages/${String(messageId)}`),
    ),
  )
})

discordAgentRoutes.get('/channels/:channelId/pins', async (c) => {
  const { channel } = await resolveDiscordChannel(c.get('teamId'), c.req.param('channelId'))
  const pins = await discord<{ items: { message: RawMessage }[] }>(
    `/channels/${channel.id}/messages/pins`,
  )

  return c.json({ messages: pins.items.map((pin) => discordMessageView(pin.message)) })
})

discordAgentRoutes.get('/channels/:channelId/threads', async (c) => {
  const { guildId, channel } = await resolveDiscordChannel(
    c.get('teamId'),
    c.req.param('channelId'),
  )
  const active = await discord<{ threads: DiscordChannel[] }>(`/guilds/${guildId}/threads/active`)

  return c.json({
    threads: active.threads
      .filter((thread) => thread.parent_id === channel.id)
      .map((thread) => ({ id: thread.id, name: thread.name })),
  })
})

discordAgentRoutes.get('/search', async (c) => {
  const teamId = c.get('teamId')
  const content = c.req.query('content')?.trim()
  const channelId = c.req.query('channelId')

  if (!content) throw new AppError(400, 'invalid_request', 'content is required')
  const scope = channelId
    ? await resolveDiscordChannel(teamId, channelId)
    : { guildId: (await requireInstallation(teamId)).guildId, channel: null }
  const enabled = await enabledChannelIds(teamId, scope.guildId)
  const query = new URLSearchParams({
    content: content.slice(0, 1024),
    limit: String(limitOf(c.req.query('limit'), 25)),
  })
  const authorId = snowflake(c.req.query('authorId'), 'authorId')

  if (authorId) query.append('author_id', authorId)
  for (const id of scope.channel ? [scope.channel.id] : enabled) query.append('channel_id', id)
  const found = await discord<{
    messages?: RawMessage[][]
    threads?: DiscordChannel[]
    retry_after?: number
  }>(`/guilds/${scope.guildId}/messages/search?${query.toString()}`)

  // Discord answers 202 without results while it indexes the server.
  if (!found.messages) return c.json({ indexing: true, retryAfter: found.retry_after ?? 0 })

  return c.json({
    messages: reachableDiscordMessages({ ...found, messages: found.messages }, enabled).map(
      discordMessageView,
    ),
  })
})

discordAgentRoutes.get('/members', async (c) => {
  const installation = await requireInstallation(c.get('teamId'))
  const name = c.req.query('query')?.trim()

  if (!name) throw new AppError(400, 'invalid_request', 'query is required')
  const query = new URLSearchParams({
    query: name,
    limit: String(limitOf(c.req.query('limit'), 25)),
  })
  const members = await discord<
    {
      nick?: string | null
      user?: { id: string; username?: string; global_name?: string | null; bot?: boolean }
    }[]
  >(`/guilds/${installation.guildId}/members/search?${query.toString()}`)

  return c.json({
    members: members.map((member) => ({
      id: member.user?.id,
      name: member.nick ?? member.user?.global_name ?? member.user?.username,
      username: member.user?.username,
      ...(member.user?.bot ? { bot: true } : {}),
    })),
  })
})

// The bot speaks for the agent, so only an agent conversation may make it:
// a member's own session has no business posting under the bot's name.
discordAgentRoutes.on(['POST', 'PUT'], '/channels/*', async (c, next) => {
  if (!c.get('conversationAgent')) {
    throw new AppError(403, 'forbidden', 'Only an agent conversation may post to Discord')
  }
  await next()
})

discordAgentRoutes.post('/channels/:channelId/messages', async (c) => {
  const teamId = c.get('teamId')
  const { channel } = await resolveDiscordChannel(teamId, c.req.param('channelId'))
  const body = (await c.req.json().catch(() => ({}))) as { content?: unknown; replyTo?: unknown }
  const chunks = typeof body.content === 'string' ? splitDiscordText(body.content) : []
  const replyTo = snowflake(typeof body.replyTo === 'string' ? body.replyTo : undefined, 'replyTo')

  if (!chunks.length) throw new AppError(400, 'invalid_request', 'content is required')
  const messageIds: string[] = []

  for (const [index, chunk] of chunks.entries()) {
    const sent = await discord<{ id: string }>(`/channels/${channel.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: chunk,
        allowed_mentions: { parse: [] },
        ...(replyTo && index === 0 ? { message_reference: { message_id: replyTo } } : {}),
      }),
    })

    messageIds.push(sent.id)
  }
  logEvent('info', 'discord.agent.api.message_posted', {
    team_id: teamId,
    user_id: c.get('userId'),
    session_id: c.get('conversationAgent')?.sessionId,
    discord_channel_id: channel.id,
  })

  return c.json({ messageIds }, 201)
})

discordAgentRoutes.put('/channels/:channelId/messages/:messageId/reactions/:emoji', async (c) => {
  const { channel } = await resolveDiscordChannel(c.get('teamId'), c.req.param('channelId'))
  const messageId = snowflake(c.req.param('messageId'), 'messageId')

  await discord(
    `/channels/${channel.id}/messages/${String(messageId)}/reactions/${encodeURIComponent(c.req.param('emoji'))}/@me`,
    { method: 'PUT' },
  )

  return c.body(null, 204)
})
