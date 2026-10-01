import { randomBytes } from 'node:crypto'

import { Hono } from 'hono'

import { mongo } from '@/lib/db'
import { getDiscordChannel } from '@/lib/discord/api'
import { getDiscordConnection } from '@/lib/discord/connection'
import { buildDiscordAuthorizeUrl, isDiscordConfigured } from '@/lib/discord/oauth'
import {
  discordChannelMappings,
  discordInstallations,
  discordPendingOAuth,
} from '@/lib/discord/store'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'
import { requireTeamRole } from '@/middleware/auth'

import {
  markDiscordApprovalsRejected,
  resolveInvalidatedDiscordApprovals,
} from './discord/approval'
import { disconnectDiscord } from './discord/lifecycle'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

export const discordInstallationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

discordInstallationsRoutes.get('/', async (c) => {
  return c.json(await getDiscordConnection(c.get('teamId'), c.get('userId')))
})

async function startOAuth(
  c: Context<{ Variables: TeamAuthVariables }>,
  operation: 'install' | 'link',
) {
  if (!isDiscordConfigured()) {
    throw new AppError(503, 'discord_not_configured', 'Discord OAuth is not configured')
  }
  const teamId = c.get('teamId')
  const requesterUserId = c.get('userId')
  const existing = await discordInstallations().findOne({ teamId })

  if (operation === 'link' && !existing) {
    throw new AppError(409, 'discord_not_installed', 'Install Discord for this team first')
  }
  const state = randomBytes(24).toString('hex')

  await discordPendingOAuth().insertOne({
    _id: state,
    operation,
    teamId,
    requesterUserId,
    ...(existing ? { expectedGuildId: existing.guildId } : {}),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  })

  return c.json({
    authorizeUrl: buildDiscordAuthorizeUrl({
      state,
      operation,
      guildId: operation === 'install' ? existing?.guildId : undefined,
    }),
    state,
  })
}

discordInstallationsRoutes.post(
  '/start-oauth',
  requireTeamRole('ADMINISTRATOR'),
  async (c) => await startOAuth(c, 'install'),
)
discordInstallationsRoutes.post('/start-link', async (c) => await startOAuth(c, 'link'))
discordInstallationsRoutes.delete('/oauth/:state', async (c) => {
  await discordPendingOAuth().deleteOne({
    _id: c.req.param('state'),
    teamId: c.get('teamId'),
    requesterUserId: c.get('userId'),
  })

  return c.json({ ok: true })
})

discordInstallationsRoutes.put(
  '/channels/:channelId',
  requireTeamRole('ADMINISTRATOR'),
  async (c) => {
    const teamId = c.get('teamId')
    const installation = await discordInstallations().findOne({ teamId, enabled: true })

    if (!installation) throw new AppError(409, 'discord_not_installed', 'Install Discord first')
    const channelId = c.req.param('channelId')
    const channel = await getDiscordChannel(channelId).catch(() => null)

    if (!channel || channel.guild_id !== installation.guildId) {
      throw new AppError(
        400,
        'discord_channel_invalid',
        'That channel is not in the installed server',
      )
    }
    const now = new Date()

    await discordChannelMappings().updateOne(
      { guildId: installation.guildId, channelId },
      {
        $setOnInsert: { teamId, createdBy: c.get('userId'), createdAt: now },
        $set: { enabled: true, updatedAt: now },
      },
      { upsert: true },
    )

    return c.json({ ok: true })
  },
)

discordInstallationsRoutes.delete(
  '/channels/:channelId',
  requireTeamRole('ADMINISTRATOR'),
  async (c) => {
    const teamId = c.get('teamId')
    const channelId = c.req.param('channelId')
    const session = mongo.startSession()
    let decisions: Awaited<ReturnType<typeof markDiscordApprovalsRejected>> = []

    try {
      await session.withTransaction(async () => {
        const mapping = await discordChannelMappings().findOne({ teamId, channelId }, { session })

        await discordChannelMappings().updateOne(
          { teamId, channelId },
          { $set: { enabled: false, updatedAt: new Date() } },
          { session },
        )
        if (mapping) {
          decisions = await markDiscordApprovalsRejected(
            { teamId, guildId: mapping.guildId, parentChannelId: channelId },
            session,
          )
        }
      })
    } finally {
      await session.endSession()
    }
    await resolveInvalidatedDiscordApprovals(decisions, 'discord_channel_disabled')

    return c.json({ ok: true })
  },
)

discordInstallationsRoutes.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = c.get('teamId')

  await disconnectDiscord(teamId)
  logEvent('info', 'discord.installation.disconnected', {
    team_id: teamId,
    user_id: c.get('userId'),
  })

  return c.body(null, 204)
})
