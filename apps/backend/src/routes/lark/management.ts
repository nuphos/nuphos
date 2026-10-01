import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import {
  createLarkPairCode,
  deleteLarkChatMapping,
  deleteLarkUserMapping,
  listLarkChatMappings,
  listLarkUserMappings,
  upsertLarkChatMapping,
} from '@/lib/lark/agent-bot'
import { listJoinedLarkGroups } from '@/lib/lark/destinations'
import { getLarkBindingForTeam, larkAppContext } from '@/lib/lark/installations'
import { parseObjectId } from '@/lib/objectid'
import { requireAuth } from '@/middleware/auth'
import { resolveVerifiedTeamId } from '@/routes/agent'

import type { LarkChatMapping, LarkUserMapping } from '@/lib/lark/agent-bot'
import type { AuthVariables } from '@/middleware/auth'
import type { Context, Hono } from 'hono'

// ─── Management API (chat + user mappings) ───────────────────────────────────
function serializeChatMapping(mapping: LarkChatMapping) {
  const { _id, ...rest } = mapping

  return { id: _id?.toString(), ...rest }
}
function serializeUserMapping(mapping: LarkUserMapping) {
  const { _id, ...rest } = mapping

  return { id: _id?.toString(), ...rest }
}

async function requireTeamAdmin(
  c: Context<{ Variables: AuthVariables }>,
  teamId: string,
): Promise<void> {
  const membership = await getTeamMembership(c.get('userId'), teamId)

  if (!membership) throw new AppError(403, 'forbidden', 'You are not a member of this team')
  if (membership.role !== 'ADMINISTRATOR') {
    throw new AppError(403, 'forbidden', 'Only team administrators can manage Lark mappings')
  }
}

async function resolveAppIdForTeam(teamId: string): Promise<string> {
  const binding = await getLarkBindingForTeam(parseObjectId(teamId, 'teamId'))

  if (!binding) throw new AppError(409, 'lark_not_installed', 'Lark is not connected for this team')

  return binding.appId
}

export function registerLarkManagementRoutes(larkRoutes: Hono<{ Variables: AuthVariables }>): void {
  larkRoutes.use('/mappings', requireAuth)
  larkRoutes.use('/mappings/*', requireAuth)
  larkRoutes.use('/user-mappings', requireAuth)
  larkRoutes.use('/user-mappings/*', requireAuth)
  larkRoutes.use('/pair-code', requireAuth)

  larkRoutes.get('/mappings', async (c) => {
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)
    const mappings = await listLarkChatMappings(teamId)

    return c.json({ mappings: mappings.map(serializeChatMapping) })
  })

  larkRoutes.put('/mappings', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const teamId = await resolveVerifiedTeamId(
      c,
      typeof body.teamId === 'string' ? body.teamId : undefined,
    )

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)
    const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : ''

    if (!chatId) throw new AppError(400, 'invalid_request', 'chatId is required')
    // `enabled:false` is a sticky mute — the receive path honours it and won't
    // re-auto-link the group on the next @mention.
    const enabled = body.enabled === undefined ? true : body.enabled === true
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined
    const appId = await resolveAppIdForTeam(teamId)
    const mapping = await upsertLarkChatMapping({
      appId,
      chatId,
      teamId,
      createdBy: c.get('userId'),
      enabled,
      ...(name ? { name } : {}),
    })

    return c.json({ mapping: serializeChatMapping(mapping) })
  })

  // Picker feed for the desktop: every group the bot is in, tagged with whether
  // it's linked + enabled. Adding the bot to a group already auto-links it, so
  // this is mostly for review / muting.
  larkRoutes.get('/available-chats', async (c) => {
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)
    const binding = await getLarkBindingForTeam(parseObjectId(teamId, 'teamId'))

    if (!binding)
      throw new AppError(409, 'lark_not_installed', 'Lark is not connected for this team')

    const [groups, mappings] = await Promise.all([
      listJoinedLarkGroups(larkAppContext(binding)),
      listLarkChatMappings(teamId),
    ])
    const byChatId = new Map(mappings.map((m) => [m.chatId, m]))
    const chats = groups.map((g) => {
      const mapping = byChatId.get(g.chatId)

      return {
        chatId: g.chatId,
        name: g.name,
        ...(g.description ? { description: g.description } : {}),
        linked: !!mapping,
        enabled: mapping ? mapping.enabled : false,
      }
    })

    return c.json({ chats })
  })

  larkRoutes.delete('/mappings/:chatId', async (c) => {
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)
    const appId = await resolveAppIdForTeam(teamId)
    const deleted = await deleteLarkChatMapping(appId, c.req.param('chatId'), teamId)

    return c.json({ ok: true, deleted })
  })

  larkRoutes.get('/user-mappings', async (c) => {
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)
    const mappings = await listLarkUserMappings(teamId)

    return c.json({ mappings: mappings.map(serializeUserMapping) })
  })

  larkRoutes.delete('/user-mappings/:openId', async (c) => {
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)
    const appId = await resolveAppIdForTeam(teamId)
    const deleted = await deleteLarkUserMapping(appId, teamId, c.req.param('openId'))

    return c.json({ ok: true, deleted })
  })

  // Self-serve account linking: any member mints a short code for THEIR OWN
  // account (not admin-only, unlike the mapping routes) and DMs it to the bot.
  larkRoutes.post('/pair-code', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const teamId = await resolveVerifiedTeamId(
      c,
      typeof body.teamId === 'string' ? body.teamId : undefined,
    )

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    const membership = await getTeamMembership(c.get('userId'), teamId)

    if (!membership) throw new AppError(403, 'forbidden', 'You are not a member of this team')
    // Fail if Lark isn't connected — there'd be no bot to DM the code to.
    await resolveAppIdForTeam(teamId)
    const { code, expiresAt } = await createLarkPairCode({ teamId, nuphosUserId: c.get('userId') })

    return c.json({ code, expiresAt: expiresAt.toISOString() })
  })
}
