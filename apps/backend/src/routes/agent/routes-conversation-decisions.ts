import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import { getReadableConversation, resolvePendingDecision } from '@/lib/agent/db'
import { canReply, conversationAccess } from '@/lib/agent/db/access'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

agent.post('/conversations/:sessionId/decisions/:toolCallId/resolve', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const toolCallId = c.req.param('toolCallId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  if (!canReply(conversationAccess(conversation, userId)))
    throw new AppError(403, 'conversation_read_only', 'You can only view this conversation')
  const body: unknown = await c.req.json().catch(() => null)
  const resolution =
    body && typeof body === 'object' && 'resolution' in body ? body.resolution : null

  if (
    !toolCallId ||
    toolCallId.length > 200 ||
    (resolution !== 'answered' && resolution !== 'dismissed')
  )
    throw new AppError(400, 'invalid_request', 'A question id and resolution are required')
  const resolved = await resolvePendingDecision(sessionId, conversation.userId, toolCallId)

  if (resolved)
    logEvent('info', 'agent.pending_decision.resolved', {
      user_id: userId,
      session_id: sessionId,
      tool_call_id: toolCallId,
      resolution,
    })

  return c.json({ ok: true, resolved })
})
