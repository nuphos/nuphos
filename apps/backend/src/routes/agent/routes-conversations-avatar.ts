import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { derivedAvatar } from '@/lib/agent/bot-avatars'
import {
  getReadableConversation,
  setConversationAvatar,
  upsertConversationShell,
} from '@/lib/agent/db'
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

// "+" on Bots: a Bot exists, with a name and a face, before anyone types. It
// has no runtime yet; its first turn picks one, as a new Task's does.
agent.post('/bots', async (c) => {
  const body = z
    .object({ teamId: z.string().optional() })
    .safeParse(await c.req.json().catch(() => ({})))
  const teamId = await resolveVerifiedTeamId(
    c,
    readTeamIdCandidate(c, body.success ? body.data.teamId : undefined),
  )

  if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')
  const sessionId = randomUUID()
  const avatar = derivedAvatar(sessionId)
  const title = 'New Bot'

  await upsertConversationShell({
    sessionId,
    userId: c.get('userId'),
    teamId,
    title,
    firstMessage: '',
    avatar,
  })

  return c.json({ sessionId, title, avatar }, 201)
})
