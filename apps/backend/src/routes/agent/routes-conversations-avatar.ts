import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { BOT_AVATARS, derivedAvatar } from '@/lib/agent/bot-avatars'
import { createBot } from '@/lib/agent/bots'
import { startConversationTurn } from '@/lib/agent/conversation-turn'
import { claimBotAvatar, getReadableConversation, setConversationAvatar } from '@/lib/agent/db'
import { systemSender } from '@/lib/agent/message-metadata'
import {
  validateRequestedAgentRuntime,
  validateRequestedRuntimeId,
} from '@/lib/claude-code-preview/runtime-routing'
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

// The owner changes a Bot's face, or takes it away to make the Bot a Task, and
// every viewer sees that. It never makes a Task a Bot: that is POST .../bot.
agent.patch('/conversations/:sessionId/avatar', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const body = avatarBody.safeParse(await c.req.json().catch(() => ({})))

  if (!body.success) throw new AppError(400, 'invalid_request', 'Unknown avatar')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.data.teamId))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation || conversation.userId !== userId)
    throw new AppError(404, 'not_found', 'Conversation not found')
  if (!(await setConversationAvatar(sessionId, body.data.avatar))) {
    if (body.data.avatar !== null && !conversation.avatar)
      throw new AppError(400, 'invalid_request', 'Only a Bot has a face to change')
    throw new AppError(404, 'not_found', 'Conversation not found')
  }

  return c.json({ avatar: body.data.avatar })
})

// "+" on Bots. It is placed on the runtime the client would start a new chat on, so its
// composer shows that runtime and its first turn runs there.
const createBotBody = z
  .object({
    teamId: z.string().optional(),
    title: z.string().trim().min(1).max(120).optional(),
    avatar: z.enum(BOT_AVATARS).optional(),
    runtimeId: z.unknown().optional(),
    agentRuntime: z.unknown().optional(),
    runtimeLabel: z.string().max(200).optional(),
  })
  .strict()

agent.post('/bots', async (c) => {
  const body = createBotBody.safeParse(await c.req.json().catch(() => ({})))

  if (!body.success) throw new AppError(400, 'invalid_request', 'Invalid Bot request')
  const { runtimeId, agentRuntime, runtimeLabel } = body.data

  validateRequestedRuntimeId(runtimeId)
  validateRequestedAgentRuntime(agentRuntime)
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.data.teamId))

  if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')

  return c.json(
    // A Bot works on its own, so it starts in full access, as a new chat would set it.
    await createBot(c.get('userId'), teamId, true, {
      title: body.data.title,
      avatar: body.data.avatar,
      agentRuntime,
      runtimeId,
      runtimeLabel,
    }),
    201,
  )
})

const MAKE_BOT_PROMPT =
  'This conversation is now a Bot: a persistent agent with its own name, face and standing instructions. ' +
  'From the conversation so far, choose a short name for yourself and write the instructions you should keep following, ' +
  'then save both with the `update_self` tool. Reply with one line saying who you are now.'

// "Make this a Bot": a top-level Task gets the face its id derives, so it is a Bot at
// once, and is asked to name and describe itself with `update_self`.
agent.post('/conversations/:sessionId/bot', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation || conversation.userId !== userId || conversation.kind === 'channel' || !teamId)
    throw new AppError(404, 'not_found', 'Conversation not found')
  if (conversation.avatar) return c.json({ avatar: conversation.avatar })
  // A sub-task stays its parent's: as a Bot it would show both there and in Bots.
  if (conversation.parentSessionId)
    throw new AppError(400, 'invalid_request', 'A sub-task cannot become a Bot')
  const avatar = derivedAvatar(sessionId)

  // A second click that lost the race finds the face set: nothing more to do.
  if (!(await claimBotAvatar(sessionId, avatar))) {
    const current = await getReadableConversation(sessionId, userId, teamId)

    return c.json({ avatar: current?.avatar ?? avatar })
  }
  // Runs or queues as its own turn; the reply streams to whoever watches. Both
  // the hand-off and the turn itself report a failure here, not as unhandled.
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
    systemSender('nuphos:make-bot', 'Nuphos'),
  )
    .then(({ run }) => run)
    .catch((error: unknown) => logError('agent.make_bot.turn_failed', error))

  return c.json({ avatar })
})
