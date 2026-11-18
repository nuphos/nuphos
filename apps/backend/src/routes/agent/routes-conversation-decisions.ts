import { z } from 'zod'

import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import { getReadableConversation, resolveInputRequest } from '@/lib/agent/db'
import { snoozeInputRequest } from '@/lib/agent/db/pending-decision'
import { answerDecision, dismissDecision } from '@/lib/agent/decision-answer'
import { canReplyIn } from '@/lib/agent/devices/conversation-computer'
import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

import type { AgentConversation } from '@/lib/agent/db'

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
const resolveBody = z.object({
  resolution: z.enum(['answered', 'dismissed']),
  reason: z.string().trim().max(1_000).optional(),
})
const SNOOZE_MAX_MS = 30 * 24 * 3_600_000
const snoozeBody = z.object({ until: z.string().datetime({ offset: true }).nullable() })

/** Marks a question answered, or dismisses it: closed, and the agent that asked is told. */
agent.post('/conversations/:sessionId/decisions/:toolCallId/resolve', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const toolCallId = c.req.param('toolCallId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  if (!(await canReplyIn(conversation, userId)))
    throw new AppError(403, 'conversation_read_only', 'You can only view this conversation')
  const body = resolveBody.safeParse(await c.req.json().catch(() => null))

  if (!toolCallId || toolCallId.length > 200 || !body.success)
    throw new AppError(400, 'invalid_request', 'A question id and resolution are required')
  const { resolution, reason } = body.data
  const resolved =
    resolution === 'dismissed'
      ? await dismiss(conversation, toolCallId, userId, reason)
      : await resolveInputRequest(sessionId, conversation.userId, toolCallId)

  if (resolved)
    logEvent('info', 'agent.pending_decision.resolved', {
      user_id: userId,
      session_id: sessionId,
      tool_call_id: toolCallId,
      resolution,
    })

  return c.json({ ok: true, resolved })
})

/** Dismissing tells the agent that asked, and says so when there was nothing left to dismiss. */
async function dismiss(
  conversation: AgentConversation,
  requestId: string,
  userId: string,
  reason: string | undefined,
) {
  if (!conversation.teamId) throw new AppError(404, 'not_found', 'Conversation not found')
  const { sender } = await createMessageMetadata(userId, 'nuphos')

  await dismissDecision({
    conversation,
    requestId,
    actor: { id: userId, displayName: sender.displayName },
    teamId: conversation.teamId,
    reason,
  })

  return true
}

/**
 * The owner snoozes a question out of their Inbox until a time, or brings it
 * back with `until: null`. It stays open and the agent is not told.
 */
agent.post('/conversations/:sessionId/decisions/:requestId/snooze', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const requestId = c.req.param('requestId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  if (conversation.userId !== userId)
    throw new AppError(403, 'forbidden', 'Only the owner can snooze a question in their Inbox')
  const body = snoozeBody.safeParse(await c.req.json().catch(() => null))
  const until = body.success && body.data.until ? new Date(body.data.until) : null
  const wait = until ? until.getTime() - Date.now() : 0

  if (!body.success || requestId.length > 200 || wait < 0 || wait > SNOOZE_MAX_MS)
    throw new AppError(400, 'invalid_request', 'Snooze until a time within the next 30 days')
  if (!(await snoozeInputRequest(sessionId, userId, requestId, until)))
    throw new AppError(409, 'decision_already_answered', 'This question is no longer open')

  return c.json({ ok: true, snoozedUntil: until?.toISOString() ?? null })
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
    actor: { id: userId, displayName: sender.displayName, avatarURL: sender.avatarURL },
    teamId: conversation.teamId,
  })
  logEvent('info', 'agent.pending_decision.answered', {
    user_id: userId,
    session_id: sessionId,
    tool_call_id: requestId,
  })

  return c.json({ ok: true })
})
