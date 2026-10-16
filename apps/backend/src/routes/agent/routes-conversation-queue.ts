// The session queue, as the people in a conversation see it: what waits to
// run, in order. Only a message's sender can take it back.

import { getReadableConversation } from '@/lib/agent/db'
import { TRANSCRIPT_SOURCES } from '@/lib/agent/pending-message-types'
import { removePendingUserMessage } from '@/lib/agent/pending-messages'
import { listPendingUserMessages } from '@/lib/agent/pending-queue'
import { AppError } from '@/lib/errors'

import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

async function readableConversation(c: Context<{ Variables: AuthVariables }>) {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(c.req.param('sessionId') ?? '', userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')

  return { userId, conversation }
}

async function queued(conversation: { userId: string; sessionId: string }) {
  const queue = await listPendingUserMessages(conversation.userId, conversation.sessionId)

  return queue.filter((message) =>
    (TRANSCRIPT_SOURCES as readonly string[]).includes(message.source),
  )
}

agent.get('/conversations/:sessionId/queue', async (c) => {
  const { userId, conversation } = await readableConversation(c)
  const owner = conversation.userId

  return c.json({
    messages: (await queued(conversation)).map((message) => ({
      id: message.id,
      source: message.source,
      senderUserId: message.actorUserId ?? owner,
      mine: message.source === 'app' && (message.actorUserId ?? owner) === userId,
      text: message.renderedText,
      receivedAt: message.receivedAt,
      ...(message.metadata ? { metadata: message.metadata } : {}),
      ...(message.chat ? { streamId: message.chat.streamId } : {}),
    })),
  })
})

agent.delete('/conversations/:sessionId/queue/:messageId', async (c) => {
  const { userId, conversation } = await readableConversation(c)
  const messageId = c.req.param('messageId')
  const message = (await queued(conversation)).find((entry) => entry.id === messageId)

  if (!message) throw new AppError(404, 'not_found', 'This message is no longer waiting')
  if (message.source !== 'app' || (message.actorUserId ?? conversation.userId) !== userId)
    throw new AppError(403, 'not_sender', 'Only the person who sent a message can take it back')
  const removed = await removePendingUserMessage(
    conversation.userId,
    conversation.sessionId,
    messageId,
  )

  if (!removed) throw new AppError(404, 'not_found', 'This message is no longer waiting')

  return c.json({
    ok: true,
    text: message.renderedText,
    ...(message.chat ? { message: message.chat.message } : {}),
  })
})
