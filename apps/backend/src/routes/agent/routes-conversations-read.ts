import { countUnreadConversations, markConversationRead } from '@/lib/agent/db/read-state'
import { AppError } from '@/lib/errors'
import { notifyBadgeChanged } from '@/lib/push/notify'
import { isTeamIdShape } from '@/lib/team-id'

import { agent } from './router'
import { normalizeOptionalTeamId, readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

agent.post('/conversations/:sessionId/read', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const seq = body.seq

  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
    throw new AppError(400, 'invalid_request', 'seq must be a non-negative integer')
  }
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))
  const state = await markConversationRead(sessionId, userId, teamId, seq)

  if (!state) throw new AppError(404, 'not_found', 'Conversation not found')
  notifyBadgeChanged(userId)

  return c.json(state)
})

agent.get('/unread-count', async (c) => {
  const requestedTeamId = normalizeOptionalTeamId(c.req.query('teamId'))

  if (!requestedTeamId || !isTeamIdShape(requestedTeamId)) {
    throw new AppError(400, 'invalid_request', 'teamId must be a valid team id')
  }
  const teamId = await resolveVerifiedTeamId(c, requestedTeamId)

  if (!teamId) throw new AppError(403, 'forbidden', 'You are not a member of this team')

  return c.json({ count: await countUnreadConversations(c.get('userId'), teamId) })
})
