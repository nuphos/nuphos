import { agentConversations, getConversationBySessionId } from '@/lib/agent/db'
import {
  isChannel,
  listChannelAgents,
  ownsChannelAgent,
  removeChannelAgent,
} from '@/lib/agent/db/channels'
import { AppError } from '@/lib/errors'
import { getTeamMembers, getTeamsByIds } from '@/lib/identity'
import { logEvent } from '@/lib/observability'
import {
  deleteSlackChannelMapping,
  getSlackChannelMapping,
  listSlackChannelMappings,
  upsertSlackChannelMapping,
} from '@/lib/slack/agent-bot'
import { describeSlackChannel } from '@/lib/slack/destinations'
import {
  bringExternalChatBot,
  ensureExternalChat,
  removeExternalChat,
} from '@/lib/slack/external-chats'
import { resolveInstalledWorkspaceBot } from '@/lib/slack/installations'
import { assertChannelMappingCreationAllowed } from '@/lib/slack/mapping-authorization'
import { requireAuth } from '@/middleware/auth'
import { resolveVerifiedTeamId } from '@/routes/agent'
import { normalizeSlackId, requireTeamAdmin, serializeMapping } from '@/routes/slack/shared'

import type { AuthVariables } from '@/middleware/auth'
import type { Context, Hono } from 'hono'

export function registerSlackMappingRoutes(slackRoutes: Hono<{ Variables: AuthVariables }>): void {
  slackRoutes.use('/mappings', requireAuth)
  slackRoutes.use('/mappings/*', requireAuth)

  slackRoutes.get('/mappings', async (c) => {
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    const mappings = await listSlackChannelMappings(teamId)

    // Enrich each mapping with the installation serving its workspace and live
    // channel metadata, so the settings page can show what a mapping actually
    // is: which installation, which workspace, which channel.
    const workspaceIds = [...new Set(mappings.map((mapping) => mapping.slackWorkspaceId))]
    const workspaces = new Map<
      string,
      { name: string; ownerTeamId: string; botToken: string } | null
    >()

    await Promise.all(
      workspaceIds.map(async (workspaceId) => {
        const bot = await resolveInstalledWorkspaceBot(workspaceId).catch(() => null)

        workspaces.set(
          workspaceId,
          bot
            ? { name: bot.workspaceName, ownerTeamId: bot.nuphosTeamId, botToken: bot.botToken }
            : null,
        )
      }),
    )
    const ownerTeamIds = [
      ...new Set(
        [...workspaces.values()]
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
          .map((entry) => entry.ownerTeamId)
          .filter((ownerTeamId) => ownerTeamId !== teamId),
      ),
    ]
    const ownerTeamNames = new Map(
      (await getTeamsByIds(ownerTeamIds)).map((team) => [team.id, team.name]),
    )

    const enriched = await Promise.all(
      mappings.map(async (mapping) => {
        const installation = workspaces.get(mapping.slackWorkspaceId) ?? null
        const channel = installation
          ? await describeSlackChannel(installation.botToken, mapping.slackChannelId)
          : null

        return {
          ...serializeMapping(mapping),
          bots: await channelBots(mapping.externalChatId, c.get('userId'), teamId),
          workspace: {
            id: mapping.slackWorkspaceId,
            name: installation?.name ?? null,
            installed: installation !== null,
            ownedByThisTeam: installation?.ownerTeamId === teamId,
            ownerTeamName:
              installation && installation.ownerTeamId !== teamId
                ? (ownerTeamNames.get(installation.ownerTeamId) ?? null)
                : null,
          },
          channel: channel
            ? {
                name: channel.name,
                isPrivate: channel.isPrivate,
                botInChannel: channel.isMember,
                archived: channel.isArchived,
              }
            : null,
        }
      }),
    )

    // The viewer's own Bots: the only ones they may bring into a channel.
    const myBots = await agentConversations()
      .find({
        teamId,
        userId: c.get('userId'),
        avatar: { $exists: true },
        kind: { $ne: 'channel' },
        archivedAt: { $exists: false },
      })
      .project<{ sessionId: string; title?: string; avatar: string }>({
        _id: 0,
        sessionId: 1,
        title: 1,
        avatar: 1,
      })
      .toArray()

    return c.json({ mappings: enriched, myBots })
  })

  slackRoutes.put('/mappings', async (c) => {
    const userId = c.get('userId')
    const body = await c.req.json()
    const teamId = await resolveVerifiedTeamId(
      c,
      typeof body.teamId === 'string' ? body.teamId : undefined,
    )

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)

    const slackWorkspaceId = normalizeSlackId(body.slackWorkspaceId, 'slackWorkspaceId')
    const slackChannelId = normalizeSlackId(body.slackChannelId, 'slackChannelId')

    // Team-side admin rights were checked above; this asserts channel-side
    // authority, since a mapping both routes the channel's messages to the team
    // and lets the team post there through the workspace's installation.
    await assertChannelMappingCreationAllowed({
      teamId,
      userId,
      slackWorkspaceId,
      slackChannelId,
    })
    const mapping = await upsertSlackChannelMapping({
      slackWorkspaceId,
      slackChannelId,
      teamId,
      createdBy: userId,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    })
    // Connected, the channel is an external chat (#3702): its Bots' hidden record.
    const installed = await resolveInstalledWorkspaceBot(slackWorkspaceId).catch(() => null)
    const described =
      installed &&
      (await describeSlackChannel(installed.botToken, slackChannelId).catch(() => null))
    const externalChatId = await ensureExternalChat(
      mapping,
      userId,
      described ? described.name : slackChannelId,
    )

    logEvent('info', 'slack.agent.mapping.upsert', {
      user_id: userId,
      team_id: teamId,
      slack_workspace_id: slackWorkspaceId,
      slack_channel_id: slackChannelId,
    })

    return c.json({ mapping: serializeMapping({ ...mapping, externalChatId }) })
  })

  // A connected channel's Bot (#3702): one per channel, brought in and taken out
  // only by its owner. An admin removes it by disconnecting the channel.
  slackRoutes.post('/mappings/:workspaceId/:channelId/bots', async (c) => {
    const body = await c.req.json()
    const { record, userId, teamId } = await connectedChannel(c, body.teamId)
    const botSessionId = typeof body.botSessionId === 'string' ? body.botSessionId : ''

    if (!(await ownsChannelAgent(botSessionId, userId, teamId)))
      throw new AppError(403, 'forbidden', 'Only a Bot’s owner can bring it into a Slack channel')
    if (!(await bringExternalChatBot(record, botSessionId)))
      throw new AppError(
        409,
        'slack_channel_has_bot',
        'This Slack channel already has a Bot; its owner takes it out before another comes in',
      )

    return c.json({ bots: await channelBots(record, userId, teamId) })
  })

  slackRoutes.delete('/mappings/:workspaceId/:channelId/bots/:botSessionId', async (c) => {
    const { record, userId, teamId } = await connectedChannel(c, c.req.query('teamId'))
    const botSessionId = c.req.param('botSessionId')

    if (!(await ownsChannelAgent(botSessionId, userId, teamId)))
      throw new AppError(403, 'forbidden', 'Only a Bot’s owner can take it out of a Slack channel')
    await removeChannelAgent(record, botSessionId)

    return c.json({ bots: await channelBots(record, userId, teamId) })
  })

  slackRoutes.delete('/mappings/:workspaceId/:channelId', async (c) => {
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)
    const deleted = await deleteSlackChannelMapping(
      normalizeSlackId(c.req.param('workspaceId'), 'workspaceId'),
      normalizeSlackId(c.req.param('channelId'), 'channelId'),
      teamId,
    )

    // A disconnected channel keeps nothing: its record and the Slack messages it held.
    if (deleted?.externalChatId) await removeExternalChat(deleted.externalChatId)

    return c.json({ ok: true, deleted: deleted !== null })
  })
}

/** The connected channel the path names, in a team the caller is in: its hidden record. */
async function connectedChannel(c: Context<{ Variables: AuthVariables }>, team: unknown) {
  const teamId = await resolveVerifiedTeamId(c, typeof team === 'string' ? team : undefined)

  if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
  const mapping = await getSlackChannelMapping(
    normalizeSlackId(c.req.param('workspaceId'), 'workspaceId'),
    normalizeSlackId(c.req.param('channelId'), 'channelId'),
  )

  if (mapping?.teamId !== teamId || !mapping.externalChatId)
    throw new AppError(404, 'not_found', 'This Slack channel is not connected')

  return { record: mapping.externalChatId, userId: c.get('userId'), teamId }
}

/** The Bot answering in a channel: whose it is, and whether it is the viewer's to remove. */
async function channelBots(externalChatId: string | undefined, viewerId: string, teamId: string) {
  const record = externalChatId ? await getConversationBySessionId(externalChatId) : null

  if (!record || !isChannel(record)) return []
  const [bots, members] = await Promise.all([listChannelAgents(record), getTeamMembers(teamId)])

  return bots.map((bot) => {
    const owner = members.find((member) => member.id === bot.ownerId)

    return { ...bot, mine: bot.ownerId === viewerId, ownerName: owner?.name || owner?.email }
  })
}
