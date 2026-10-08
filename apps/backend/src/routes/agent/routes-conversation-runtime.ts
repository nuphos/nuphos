import { agent } from './router'
import { resolveVerifiedTeamId, readTeamIdCandidate } from './team-scope'

import { getReadableConversation } from '@/lib/agent/db'
import { canReply, conversationAccess } from '@/lib/agent/db/access'
import { getActiveAgentRunForSession } from '@/lib/agent/run-store'
import {
  cancelConversationRuntime,
  conversationExecutionState,
  steerConversationRuntime,
} from '@/lib/claude-code-preview/session-execution-state'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

agent.post('/conversations/:sessionId/cancel-runtime', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  if (conversation.userId !== userId) {
    const active = await getActiveAgentRunForSession(conversation.userId, sessionId)

    if (active?.actorUserId !== userId)
      throw new AppError(403, 'forbidden', 'You can only stop your own active turn')
  }
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
  // Started the turn, but may have been made view-only since.
  if (!canReply(conversationAccess(conversation, userId)))
    throw new AppError(403, 'conversation_read_only', 'You can only view this conversation')
  const body = await c.req.json<{ text?: unknown }>()
  const text = typeof body.text === 'string' ? body.text.trim() : ''

  if (!text) throw new AppError(400, 'invalid_request', 'text is required')
  const runtime = await conversationExecutionState(conversation)

  if (!runtime.actions?.steer)
    throw new AppError(409, 'runtime_steering_unavailable', 'This agent cannot accept steering')
  const active = await getActiveAgentRunForSession(conversation.userId, sessionId)

  // This guard protects the actor's credential scope, not runtime activity.
  if (!active?.actorUserId || active.actorUserId !== userId)
    throw new AppError(
      409,
      'conversation_actor_unavailable',
      'The running turn is not owned by your current credential context',
    )
  const messageId = crypto.randomUUID()

  await steerConversationRuntime(conversation, text, messageId)

  return c.json({ ok: true, messageId })
})
