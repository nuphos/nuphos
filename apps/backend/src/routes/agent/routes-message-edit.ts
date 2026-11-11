import { z } from 'zod'

import {
  getConversationBySessionId,
  getReadableConversation,
  recordMessageEditedInFork,
} from '@/lib/agent/db'
import { canReplyIn } from '@/lib/agent/devices/conversation-computer'
import { AppError } from '@/lib/errors'

import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

const editForkBody = z
  .object({ forkSessionId: z.string().min(1), teamId: z.string().optional() })
  .strict()

/**
 * Editing a sent message runs it again in a fork and leaves this conversation
 * as it was. Record that here once the fork is stored, so this conversation
 * links to it. Only someone who can reply here may, and only for their own fork
 * in the same team.
 */
agent.post('/conversations/:sessionId/edit-forks', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const { forkSessionId, teamId: candidate } = editForkBody.parse(await c.req.json())
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, candidate))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  if (!(await canReplyIn(conversation, userId)))
    throw new AppError(403, 'conversation_read_only', 'You can only view this conversation')
  const fork = forkSessionId === sessionId ? null : await getConversationBySessionId(forkSessionId)

  if (fork?.userId !== userId || (fork.teamId ?? undefined) !== (conversation.teamId ?? undefined))
    throw new AppError(404, 'fork_not_found', 'Fork not found')
  await recordMessageEditedInFork(sessionId, userId, forkSessionId)

  return c.json({ ok: true })
})
