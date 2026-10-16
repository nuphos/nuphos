import { agent } from './router'
import { resolveVerifiedTeamId, readTeamIdCandidate } from './team-scope'

import { getReadableConversation, retractTrailingUserMessage } from '@/lib/agent/db'
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
  const messageId = steeringMessageId(groupId)
  const sent = await steerConversationRuntime(conversation, { text, groupId, userId }, messageId)

  return c.json({
    ok: true,
    messageId,
    text: sent,
    upload: steeringReceipt(messageId, sent).upload,
  })
})

const TURN_END_WAIT_MS = 15_000
const TURN_END_POLL_MS = 250

/**
 * Take back the caller's own just-sent message: stop its turn, wait for the
 * turn to write its (empty) end, then drop the message. Refused once the turn
 * produced any output, so nothing anyone saw is ever erased.
 */
agent.post('/conversations/:sessionId/messages/:messageId/retract', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const messageId = c.req.param('messageId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const read = () => getReadableConversation(sessionId, userId, teamId)
  const conversation = await read()

  if (!conversation?.teamId) throw new AppError(404, 'not_found', 'Conversation not found')
  if (!canReply(conversationAccess(conversation, userId)))
    throw new AppError(403, 'conversation_read_only', 'You can only view this conversation')
  if (!conversation.claudeCodePreviewContext?.activeTurnKey)
    throw new AppError(409, 'turn_not_running', 'The message has no running turn to take back')
  const { teamId: conversationTeamId, userId: ownerUserId } = conversation
  const retract = async (dryRun: boolean) => {
    const outcome = await retractTrailingUserMessage({
      sessionId,
      ownerUserId,
      teamId: conversationTeamId,
      messageId,
      actorUserId: userId,
      dryRun,
    })

    if (outcome === 'not_found') throw new AppError(404, 'not_found', 'Message not found')
    if (outcome === 'not_sender')
      throw new AppError(403, 'not_message_sender', 'Only the sender can take back a message')
    if (outcome === 'answered')
      throw new AppError(409, 'message_answered', 'The agent already answered this message')
  }

  // Checked before stopping too, so nobody stops a turn they could not retract.
  await retract(true)
  await cancelConversationRuntime(conversation)
  for (let waited = 0; ; waited += TURN_END_POLL_MS) {
    if (!(await read())?.claudeCodePreviewContext?.activeTurnKey) break
    if (waited >= TURN_END_WAIT_MS)
      throw new AppError(409, 'turn_still_running', 'The turn did not stop in time')
    await Bun.sleep(TURN_END_POLL_MS)
  }
  await retract(false)
  logEvent('info', 'agent.message.retracted', {
    trace_id: c.get('requestId'),
    user_id: userId,
    team_id: teamId,
    session_id: sessionId,
  })

  return c.json({ ok: true })
})
