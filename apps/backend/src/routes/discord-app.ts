import { Hono } from 'hono'

import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { getDiscordGuild } from '@/lib/discord/api'
import { exchangeDiscordCode, isDiscordConfigured } from '@/lib/discord/oauth'
import { discordPendingOAuth } from '@/lib/discord/store'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

import { completeDiscordOAuth } from './discord/lifecycle'

import type { Context } from 'hono'

export const discordAppRoutes = new Hono()
const CALLBACK = 'nuphos://discord-callback'

const callback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, CALLBACK, params)

discordAppRoutes.get('/setup', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const error = c.req.query('error')

  if (!state) return callback(c, { error: 'invalid_state' })
  const pending = await discordPendingOAuth().findOne({ _id: state })

  if (!pending || pending.expiresAt.getTime() <= Date.now()) {
    return callback(c, { state, error: 'expired_state' })
  }
  if (error || !code) return callback(c, { state, error: error ?? 'missing_code' })
  const membership = await getTeamMembership(pending.requesterUserId, pending.teamId)

  if (!membership || (pending.operation === 'install' && membership.role !== 'ADMINISTRATOR')) {
    return callback(c, { state, error: 'permission_denied' })
  }

  let result: Awaited<ReturnType<typeof exchangeDiscordCode>>

  try {
    result = await exchangeDiscordCode(code)
  } catch (err) {
    return callback(c, {
      state,
      error: 'exchange_failed',
      error_description: err instanceof Error ? err.message : String(err),
    })
  }

  let guild: { id: string; name: string } | undefined

  if (pending.operation === 'install') {
    if (!result.guild) return callback(c, { state, error: 'missing_guild' })
    if (pending.expectedGuildId && pending.expectedGuildId !== result.guild.id) {
      return callback(c, { state, error: 'guild_mismatch' })
    }
    try {
      guild = await getDiscordGuild(result.guild.id)
    } catch {
      return callback(c, { state, error: 'bot_not_in_guild' })
    }
  }
  let installation: Awaited<ReturnType<typeof completeDiscordOAuth>>

  try {
    installation = await completeDiscordOAuth({ pending, discordUserId: result.user.id, guild })
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return callback(c, { state, error: 'discord_binding_conflict' })
    }
    const reason = err instanceof Error ? err.message : ''

    if (
      [
        'expired_state',
        'installation_changed',
        'discord_account_already_linked',
        'missing_guild',
      ].includes(reason)
    ) {
      return callback(c, { state, error: reason })
    }
    throw err
  }
  logEvent('info', 'discord.oauth.completed', {
    operation: pending.operation,
    team_id: pending.teamId,
    guild_id: installation.guildId,
    discord_user_id: result.user.id,
  })

  return callback(c, {
    state,
    team_id: pending.teamId,
    guild_id: installation.guildId,
    guild_name: installation.guildName,
    discord_user_id: result.user.id,
  })
})

discordAppRoutes.get('/configured', (c) => c.json({ configured: isDiscordConfigured() }))
