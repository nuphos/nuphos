import { z } from 'zod'

import { getReadableConversation } from '@/lib/agent/db'
import { decideToolApproval } from '@/lib/claude-code-preview/tool-approval-decide'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

const body = z.object({ decision: z.enum(['allow', 'reject']) }).strict()

/** The owner allows or rejects a tool call their conversation's turn is waiting on. */
agent.post('/conversations/:sessionId/tool-approvals/:toolCallId', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const toolCallId = c.req.param('toolCallId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  const parsed = body.safeParse(await c.req.json().catch(() => null))

  if (!toolCallId || toolCallId.length > 200 || !parsed.success)
    throw new AppError(400, 'invalid_request', 'A tool call id and a decision are required')
  if (conversation.userId !== userId)
    throw new AppError(403, 'not_owner', "Only the conversation's owner can decide this request")
  const result = await decideToolApproval({
    userId,
    sessionId,
    toolCallId,
    decision: parsed.data.decision,
  })

  if (result === 'forbidden')
    throw new AppError(403, 'wrong_principal', 'This request waits for someone else')
  if (result === 'expired')
    throw new AppError(409, 'request_expired', 'This request has expired or was already decided')
  logEvent('info', 'agent.tool_approval.decided', {
    session_id: sessionId,
    tool_call_id: toolCallId,
    decision: parsed.data.decision,
  })

  return c.json({ ok: true })
})
