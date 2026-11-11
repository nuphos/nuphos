import { Hono } from 'hono'

import { executeTrelloTool } from '@/lib/byos/trello'
import { finishConnectorOAuth } from '@/lib/connector-oauth'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { composioUserId } from '@/lib/personal-credentials/composio'
import { trelloPendingOAuth } from '@/models'
import { persistTrelloBinding } from '@/routes/trello-integrations'

export const trelloAppRoutes = new Hono()

trelloAppRoutes.get('/setup', async (c) => {
  const state = c.req.query('state') ?? ''
  const back = (params: Record<string, string>) =>
    desktopCallbackResponse(c, 'nuphos://trello-callback', { state, ...params })

  if (!/^[a-f0-9]{48}$/iu.test(state)) return back({ error: 'invalid_state' })
  const pending = await trelloPendingOAuth().findOneAndDelete({ _id: state })

  if (!pending || pending.expiresAt.getTime() < Date.now()) return back({ error: 'expired_state' })
  if (c.req.query('status') !== 'success') return back({ error: 'access_denied' })
  try {
    const userId = composioUserId(pending.teamId.toHexString(), pending.requesterUserId)
    const profile = await executeTrelloTool(
      pending.composioAccountId,
      userId,
      'TRELLO_GET_MEMBERS_BY_ID_MEMBER',
      { idMember: 'me' },
    )
    const member = profile.data as { id?: unknown; username?: unknown }

    if (
      typeof member.id !== 'string' ||
      !member.id ||
      typeof member.username !== 'string' ||
      !member.username
    )
      throw new AppError(502, 'trello_invalid_profile', 'Trello profile is unavailable')

    return back(
      await finishConnectorOAuth({
        provider: 'trello',
        defer: true,
        state,
        teamId: pending.teamId,
        requesterUserId: pending.requesterUserId,
        draft: {
          memberId: member.id,
          username: member.username,
          authorizedBy: pending.requesterUserId,
          composioAccountId: pending.composioAccountId,
          composioUserId: userId,
        },
        persist: persistTrelloBinding,
      }),
    )
  } catch {
    return back({ error: 'trello_connection_failed' })
  }
})
