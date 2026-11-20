import { z } from 'zod'

import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import { wakeOnHandBack } from '@/lib/agent/browser-hand-back'
import { getReadableConversation } from '@/lib/agent/db'
import { canReplyIn } from '@/lib/agent/devices/conversation-computer'
import { AppError } from '@/lib/errors'

const handBackBody = z.object({ tab: z.number().int().positive() }).strict()

/** A person closed a browser window the agent showed them: the agent is woken to carry on. */
agent.post('/conversations/:sessionId/browser/hand-back', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation?.teamId) throw new AppError(404, 'not_found', 'Conversation not found')
  if (!(await canReplyIn(conversation, userId)))
    throw new AppError(403, 'conversation_read_only', 'You can only view this conversation')
  const body = handBackBody.safeParse(await c.req.json().catch(() => null))

  if (!body.success) throw new AppError(400, 'invalid_request', 'A hand-back needs the tab id')
  await wakeOnHandBack(conversation, conversation.teamId, body.data.tab)

  return c.json({ ok: true })
})
