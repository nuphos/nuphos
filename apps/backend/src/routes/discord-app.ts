import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { finishConnectorOAuth } from '@/lib/connector-oauth'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { getDiscordGuild } from '@/lib/discord/api'
import { exchangeDiscordCode, isDiscordConfigured } from '@/lib/discord/oauth'
import { discordPendingOAuth } from '@/lib/discord/store'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

import { completeDiscordOAuth } from './discord/lifecycle'

import type { DiscordPendingOAuth } from '@/lib/discord/store'
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
  const draft: DiscordBindingDraft = { pending, discordUserId: result.user.id, guild }

  return callback(
    c,
    await finishConnectorOAuth({
      provider: 'discord',
      state,
      teamId: new ObjectId(pending.teamId),
      requesterUserId: pending.requesterUserId,
      draft,
      persist: persistDiscordBinding,
    }),
  )
})

// The pending doc is still unconsumed here: completeDiscordOAuth claims it in
// the same transaction as the grants, so a disconnect or cancel in between
// still voids a staged grant.
type DiscordBindingDraft = {
  pending: DiscordPendingOAuth
  discordUserId: string
  guild?: { id: string; name: string }
}

export async function persistDiscordBinding(
  teamId: ObjectId,
  draft: DiscordBindingDraft,
): Promise<Record<string, string>> {
  const { pending, discordUserId, guild } = draft

  // The staged team must be the one completing; Discord keys teams by string.
  if (!teamId.equals(pending.teamId)) return { error: 'expired_state' }
  let installation: Awaited<ReturnType<typeof completeDiscordOAuth>>

  try {
    installation = await completeDiscordOAuth({ pending, discordUserId, guild })
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return { error: 'discord_binding_conflict' }
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
      return { error: reason }
    }
    throw err
  }
  logEvent('info', 'discord.oauth.completed', {
    operation: pending.operation,
    team_id: pending.teamId,
    guild_id: installation.guildId,
    discord_user_id: discordUserId,
  })

  return {
    team_id: pending.teamId,
    guild_id: installation.guildId,
    guild_name: installation.guildName,
    discord_user_id: discordUserId,
  }
}

discordAppRoutes.get('/configured', (c) => c.json({ configured: isDiscordConfigured() }))
