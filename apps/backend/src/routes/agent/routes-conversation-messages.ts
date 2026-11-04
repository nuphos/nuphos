import { getConversationMessages, getReadableConversation } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'

import { serializeMessageDoc } from './errors'
import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

// Page backwards through transcript messages before the absolute `before`
// index; `firstIndex` becomes the cursor until it reaches zero.
agent.get('/conversations/:sessionId/messages', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const before = Number.parseInt(c.req.query('before') ?? '', 10)

  if (!Number.isInteger(before) || before < 1) {
    throw new AppError(400, 'invalid_request', 'before must be a positive integer')
  }
  const limitRaw = c.req.query('limit')
  const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : 100

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new AppError(400, 'invalid_request', 'limit must be an integer between 1 and 1000')
  }
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }
  const messages = await getConversationMessages(sessionId, conversation.userId, {
    beforeIndex: before,
    tail: limit,
  })

  return c.json({
    messages: messages.map(serializeMessageDoc),
    firstIndex: messages[0]?.index ?? 0,
  })
})
