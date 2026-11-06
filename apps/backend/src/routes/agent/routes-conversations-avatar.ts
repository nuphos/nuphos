import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { derivedAvatar } from '@/lib/agent/bot-avatars'
import { startConversationTurn } from '@/lib/agent/conversation-turn'
import {
  getReadableConversation,
  setConversationAvatar,
  upsertConversationShell,
} from '@/lib/agent/db'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

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

const MAKE_BOT_PROMPT =
  'This conversation is now a Bot: a persistent agent with its own name, face and standing instructions. ' +
  'From the conversation so far, choose a short name for yourself and write the instructions you should keep following, ' +
  'then save both with the `update_self` tool. Reply with one line saying who you are now.'

// "Make this a Bot": the Task gets the face its id derives, so it is a Bot at
// once, and is asked to name and describe itself with `update_self`.
agent.post('/conversations/:sessionId/bot', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation || conversation.userId !== userId || conversation.kind === 'channel' || !teamId)
    throw new AppError(404, 'not_found', 'Conversation not found')
  if (conversation.avatar) return c.json({ avatar: conversation.avatar })
  const avatar = derivedAvatar(sessionId)

  if (!(await setConversationAvatar(sessionId, avatar)))
    throw new AppError(404, 'not_found', 'Conversation not found')
  // Runs or queues as its own turn; the reply streams to whoever watches.
  void startConversationTurn(
    {
      userId,
      teamId,
      targetSessionId: sessionId,
      messageId: randomUUID(),
      locale: conversation.metadata?.locale ?? 'en-US',
    },
    { ...conversation, avatar },
    MAKE_BOT_PROMPT,
    'agent.resource',
    {
      version: 1,
      sender: { type: 'system', id: 'nuphos:make-bot', displayName: 'Nuphos' },
      source: 'agent.resource',
      sentAt: new Date().toISOString(),
    },
  ).catch((error: unknown) => logError('agent.make_bot.turn_failed', error))

  return c.json({ avatar })
})
