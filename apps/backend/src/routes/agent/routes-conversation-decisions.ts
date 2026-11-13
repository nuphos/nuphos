import { z } from 'zod'

import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import { getReadableConversation, resolveInputRequest } from '@/lib/agent/db'
import { answerDecision } from '@/lib/agent/decision-answer'
import { canReplyIn } from '@/lib/agent/devices/conversation-computer'
import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

const choices = z.array(z.string().trim().min(1).max(300)).max(10)
const text = z.string().trim().min(1).max(8_000)
const answerBody = z
  .object({
    choices: choices.optional(),
    text: text.optional(),
    questions: z
      .array(z.object({ choices: choices.optional(), text: text.optional() }).strict())
      .max(4)
      .optional(),
  })
  .strict()
  .refine((answer) => answer.choices?.length || answer.text || answer.questions?.length)

agent.post('/conversations/:sessionId/decisions/:toolCallId/resolve', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const toolCallId = c.req.param('toolCallId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  if (!(await canReplyIn(conversation, userId)))
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
  const resolved = await resolveInputRequest(sessionId, conversation.userId, toolCallId)

  if (resolved)
    logEvent('info', 'agent.pending_decision.resolved', {
      user_id: userId,
      session_id: sessionId,
      tool_call_id: toolCallId,
      resolution,
    })

  return c.json({ ok: true, resolved })
})

/** A person answers a question: no message is sent; the asking agent is woken with the answer. */
agent.post('/conversations/:sessionId/decisions/:requestId/answer', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const requestId = c.req.param('requestId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation?.teamId) throw new AppError(404, 'not_found', 'Conversation not found')
  if (!(await canReplyIn(conversation, userId)))
    throw new AppError(403, 'conversation_read_only', 'You can only view this conversation')
  const answer = answerBody.safeParse(await c.req.json().catch(() => null))

  if (!answer.success || requestId.length > 200)
    throw new AppError(400, 'invalid_request', 'An answer needs choices, text or questions')
  const { sender } = await createMessageMetadata(userId, 'nuphos')

  await answerDecision({
    conversation,
    requestId,
    answer: answer.data,
    actor: { id: userId, displayName: sender.displayName },
    teamId: conversation.teamId,
  })
  logEvent('info', 'agent.pending_decision.answered', {
    user_id: userId,
    session_id: sessionId,
    tool_call_id: requestId,
  })

  return c.json({ ok: true })
})
