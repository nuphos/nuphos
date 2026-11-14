import { randomUUID } from 'node:crypto'

import { Hono } from 'hono'

import {
  agentConversations,
  getConversationBySessionId,
  getReadableConversation,
  upsertConversationShell,
} from '@/lib/agent/db'
import {
  addChannelAgent,
  isChannel,
  listChannelAgents,
  listChannelMentions,
  ownsChannelAgent,
  removeChannelAgent,
} from '@/lib/agent/db/channels'
import { addConversationParticipants } from '@/lib/agent/db/participants'
import { channelUploadPart, resolveChannelFiles } from '@/lib/agent/channel-attachments'
import { channelFacesField } from '@/lib/agent/channel-faces'
import { postChannelMessage, replyQuote, wakeChannelAgents } from '@/lib/agent/channel-chat'
import { resolveMentions } from '@/lib/agent/mentions'
import { answerInputRequest } from '@/lib/agent/plan-decision'
import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { AppError } from '@/lib/errors'

import { buildConversationOwnerMap } from './conversation-view'
import { assertDecisionUnanswered, decisionReplyOf } from './decision-reply'
import {
  assertConversationSendable,
  readTeamIdCandidate,
  resolveVerifiedTeamId,
} from './team-scope'

import type { AgentConversation } from '@/lib/agent/db'
import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

// A channel is a conversation that runs no agent: a channel where people and
// agents talk. Its people are the conversation's participants, managed by the
// participants routes; this router adds the agents and the messages.
export const channelRoutes = new Hono<{ Variables: AuthVariables }>()

const MAX_TITLE_LENGTH = 200
// A chat message, not a document.
const MAX_MESSAGE_LENGTH = 20_000

type Body = Record<string, unknown>

async function readBody(c: Context): Promise<Body> {
  return (await c.req.json().catch(() => ({}))) as Body
}

async function requireTeam(c: Context<{ Variables: AuthVariables }>, body: Body = {}) {
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))

  if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')

  return teamId
}

function requireText(value: unknown, name: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : ''

  if (!text || text.length > max)
    throw new AppError(400, 'invalid_request', `${name} must be 1 to ${String(max)} characters`)

  return text
}

function channelOrNotFound(conversation: AgentConversation | null): AgentConversation {
  if (!conversation || !isChannel(conversation))
    throw new AppError(404, 'not_found', 'Channel not found')

  return conversation
}

async function agentsResponse(channel: AgentConversation | null) {
  return { agents: await listChannelAgents(channelOrNotFound(channel)) }
}

channelRoutes.post('/channels', async (c) => {
  const body = await readBody(c)
  const teamId = await requireTeam(c, body)
  // A chat may go unnamed: each member then sees it called by the others in it.
  const title = typeof body.title === 'string' ? body.title.trim() : ''

  if (title.length > MAX_TITLE_LENGTH)
    throw new AppError(
      400,
      'invalid_request',
      `title must be at most ${String(MAX_TITLE_LENGTH)} characters`,
    )
  const sessionId = randomUUID()

  await upsertConversationShell({
    sessionId,
    userId: c.get('userId'),
    teamId,
    title,
    firstMessage: '',
    kind: 'channel',
  })
  if (body.group === true)
    await agentConversations().updateOne({ sessionId }, { $set: { group: true } })

  return c.json({ sessionId }, 201)
})

// The Inbox's channel entries: posts that @mention the viewer, until they reply there.
channelRoutes.get('/channels/mentions', async (c) => {
  const teamId = await requireTeam(c)
  const viewerId = c.get('userId')
  const mentions = await listChannelMentions(teamId, viewerId)
  const unnamed = mentions.filter((mention) => mention.kind === 'channel' && !mention.title)

  if (unnamed.length === 0) return c.json({ mentions })
  // An unnamed chat is called by everyone but the viewer, as in the chat list.
  const people = await buildConversationOwnerMap(teamId, [])
  const titles = new Map(
    await Promise.all(
      unnamed.map(async (mention) => {
        const channel = await getConversationBySessionId(mention.channelId)
        const named = channel ? await channelFacesField(channel, viewerId, people) : {}

        return [mention.channelId, named.title ?? ''] as const
      }),
    ),
  )

  return c.json({
    mentions: mentions.map((mention) => ({
      ...mention,
      title: titles.get(mention.channelId) ?? mention.title,
    })),
  })
})

channelRoutes.get('/conversations/:sessionId/agents', async (c) => {
  const teamId = await requireTeam(c)

  return c.json(
    await agentsResponse(
      await getReadableConversation(c.req.param('sessionId'), c.get('userId'), teamId),
    ),
  )
})

// Adding an agent is its owner's word that everyone here may talk to it, so
// only its owner can, from inside the channel. Approvals stay with the owner.
channelRoutes.post('/conversations/:sessionId/agents', async (c) => {
  const userId = c.get('userId')
  const body = await readBody(c)
  const teamId = await requireTeam(c, body)
  const channelId = c.req.param('sessionId')

  channelOrNotFound(await assertConversationSendable(channelId, userId, teamId))
  const agentSessionId = body.sessionId

  if (typeof agentSessionId !== 'string' || !agentSessionId)
    throw new AppError(400, 'invalid_request', 'sessionId must name the agent’s conversation')
  if (!(await ownsChannelAgent(agentSessionId, userId, teamId)))
    throw new AppError(403, 'forbidden', 'Only its owner can add this agent')

  return c.json(await agentsResponse(await addChannelAgent(channelId, agentSessionId)))
})

// Either side may end it: the channel's owner, or the agent's owner, even when
// they cannot read the channel it was brought into.
channelRoutes.delete('/conversations/:sessionId/agents/:agentSessionId', async (c) => {
  const userId = c.get('userId')
  const teamId = await requireTeam(c)
  const channelId = c.req.param('sessionId')
  const agentSessionId = c.req.param('agentSessionId')
  const found = await getConversationBySessionId(channelId)
  const channel = channelOrNotFound(found?.teamId === teamId ? found : null)

  if (channel.userId !== userId && !(await ownsChannelAgent(agentSessionId, userId, teamId)))
    throw new AppError(
      403,
      'forbidden',
      'Only the channel owner or the agent’s owner can remove it',
    )

  await removeChannelAgent(channelId, agentSessionId)

  // Nothing back: the agent's owner may not be allowed to see who else is here.
  return c.body(null, 204)
})

// Retry after an agent could not reply: it reads again what it has not read yet.
channelRoutes.post('/conversations/:sessionId/agents/:agentSessionId/wake', async (c) => {
  const teamId = await requireTeam(c)
  const channel = channelOrNotFound(
    await assertConversationSendable(c.req.param('sessionId'), c.get('userId'), teamId),
  )
  const agentSessionId = c.req.param('agentSessionId')

  if (!channel.agentSessionIds?.includes(agentSessionId))
    throw new AppError(404, 'not_found', 'This agent is not in the channel')
  // A person's wake, as their post would be, but for this agent alone.
  await wakeChannelAgents({ ...channel, teamId, agentSessionIds: [agentSessionId] }, undefined)

  return c.body(null, 204)
})

// A file posted here, for anyone who can read the chat.
channelRoutes.get('/conversations/:sessionId/attachments/:groupId', async (c) => {
  const teamId = await requireTeam(c)
  const channel = channelOrNotFound(
    await getReadableConversation(c.req.param('sessionId'), c.get('userId'), teamId),
  )

  return c.json(await resolveChannelFiles(channel, c.req.param('groupId')))
})

// Records the message and wakes the channel's agents; each decides whether to answer.
channelRoutes.post('/conversations/:sessionId/channel-messages', async (c) => {
  const userId = c.get('userId')
  const body = await readBody(c)
  const teamId = await requireTeam(c, body)
  const channel = channelOrNotFound(
    await assertConversationSendable(c.req.param('sessionId'), userId, teamId),
  )
  // A file may go without words, as in any chat.
  const upload =
    typeof body.upload === 'string' && body.upload
      ? await channelUploadPart(teamId, userId, body.upload)
      : undefined
  const text =
    upload && !(typeof body.text === 'string' && body.text.trim())
      ? ''
      : requireText(body.text, 'text', MAX_MESSAGE_LENGTH)
  // A client id makes a resend the same message; the transcript skips ids it has.
  const id = typeof body.id === 'string' && body.id.length <= 100 ? body.id : randomUUID()
  const [metadata, mentions] = await Promise.all([
    createMessageMetadata(
      userId,
      'nuphos',
      c.req.header('X-Nuphos-Device-Id')?.trim() || undefined,
    ),
    resolveMentions(teamId, body.mentions, userId),
  ])

  if (mentions.length > 0) metadata.mentions = mentions
  // A reply quotes what it answers, as the server read it; an unknown id is no reply.
  const replyTo = await replyQuote(channel, body.replyTo)

  if (replyTo) metadata.replyTo = replyTo
  // A post may answer a question an agent in the chat asked: the post is the answer.
  const decisionReplyTo = decisionReplyOf(body)
  const asked = decisionReplyTo ? await askingAgent(channel, decisionReplyTo, id) : undefined

  await postChannelMessage(channel, { id, text, metadata, files: upload ? [upload] : [] })
  if (asked && decisionReplyTo)
    await answerInputRequest({
      sessionId: asked.sessionId,
      userId: asked.userId,
      requestId: decisionReplyTo,
      answer: text,
      actorUserId: userId,
      teamId,
    })
  // Speaking in a channel is joining it, as it is anywhere else.
  if (userId !== channel.userId) await addConversationParticipants(channel.sessionId, [userId])

  return c.json({ id }, 201)
})

/** The chat's agent that asked this question, while one answer may still take it. */
async function askingAgent(channel: AgentConversation, requestId: string, messageId: string) {
  const asked = await agentConversations().findOne({
    sessionId: { $in: channel.agentSessionIds ?? [] },
    'inputRequests.id': requestId,
  })

  if (!asked) throw new AppError(404, 'not_found', 'No agent in this chat asked that question')
  await assertDecisionUnanswered(asked, requestId, messageId)

  return asked
}
