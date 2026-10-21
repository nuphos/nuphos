import { agent } from './router'
import { resolveVerifiedTeamId, readTeamIdCandidate } from './team-scope'

import { getReadableConversation } from '@/lib/agent/db'
import { getActiveAgentRunForSession } from '@/lib/agent/run-store'
import { canReply, conversationAccess } from '@/lib/agent/db/access'
import {
  cancelConversationRuntime,
  conversationExecutionState,
  steerConversationRuntime,
} from '@/lib/claude-code-preview/session-execution-state'
import { steeringMessageId, steeringReceipt } from '@/lib/claude-code-preview/steering-receipt'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

agent.post('/conversations/:sessionId/cancel-runtime', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  if (!canReply(conversationAccess(conversation, userId)))
    throw new AppError(403, 'conversation_read_only', 'You can only view this conversation')
  await cancelConversationRuntime(conversation)
  logEvent('info', 'agent.runtime.cancel_requested', {
    trace_id: c.get('requestId'),
    auth_source: 'authenticated_http',
    user_id: userId,
    team_id: teamId,
    session_id: sessionId,
    runtime_id: conversation.runtimeId,
  })

  return c.json({ ok: true, status: 'requested' })
})

agent.post('/conversations/:sessionId/steer', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  if (!canReply(conversationAccess(conversation, userId)))
    throw new AppError(403, 'conversation_read_only', 'You can only view this conversation')
  const body = await c.req.json<{ text?: unknown; groupId?: unknown }>()
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const groupId = typeof body.groupId === 'string' ? body.groupId : ''

  if (!text && !groupId) throw new AppError(400, 'invalid_request', 'text or groupId is required')
  const runtime = await conversationExecutionState(conversation)

  if (!runtime.actions?.steer)
    throw new AppError(409, 'runtime_steering_unavailable', 'This agent cannot accept steering')
  // Only the person who started the running turn steers it; anyone else's message waits its turn.
  const active = await getActiveAgentRunForSession(conversation.userId, sessionId)

  if (active && (!active.humanTurn || (active.actorUserId && active.actorUserId !== userId)))
    throw new AppError(
      409,
      'runtime_steering_unavailable',
      'Someone else started the running turn; send your message to run after it',
    )
  const messageId = steeringMessageId(groupId)
  const sent = await steerConversationRuntime(conversation, { text, groupId, userId }, messageId)

  return c.json({
    ok: true,
    messageId,
    text: sent,
    upload: steeringReceipt(messageId, sent).upload,
  })
})
