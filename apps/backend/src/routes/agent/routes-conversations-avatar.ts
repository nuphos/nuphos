import { z } from 'zod'

import { getReadableConversation, setConversationAvatar } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'

import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

const avatarBody = z
  .object({
    // A bot-avatar file name without `.svg`, e.g. `05-rembrandt`; null resets it.
    avatar: z
      .string()
      .regex(/^\d{2}-[a-z0-9-]{1,40}$/)
      .nullable(),
    teamId: z.string().optional(),
  })
  .strict()

// Whoever may archive the Agent may also pick its character, and every viewer
// sees that pick.
agent.patch('/conversations/:sessionId/avatar', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const body = avatarBody.safeParse(await c.req.json().catch(() => ({})))

  if (!body.success) throw new AppError(400, 'invalid_request', 'Unknown avatar')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.data.teamId))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (
    !conversation ||
    conversation.userId !== userId ||
    !(await setConversationAvatar(sessionId, body.data.avatar))
  ) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }

  return c.json({ avatar: body.data.avatar })
})
