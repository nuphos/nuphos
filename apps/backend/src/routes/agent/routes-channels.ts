import { randomUUID } from 'node:crypto'

import { Hono } from 'hono'

import {
  appendConversationMessages,
  getConversationBySessionId,
  getReadableConversation,
  upsertConversationShell,
} from '@/lib/agent/db'
import {
  addChannelAgent,
  isChannel,
  listChannelAgents,
  removeChannelAgent,
} from '@/lib/agent/db/channels'
import { addConversationParticipants } from '@/lib/agent/db/participants'
import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { AppError } from '@/lib/errors'

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

/** Whether the caller owns this agent, i.e. its session. */
async function ownsAgent(agentSessionId: string, userId: string, teamId: string) {
  const agent = await getConversationBySessionId(agentSessionId)

  if (!agent || agent.teamId !== teamId || isChannel(agent))
    throw new AppError(404, 'not_found', 'Agent conversation not found')

  return agent.userId === userId
}

async function agentsResponse(channel: AgentConversation | null) {
  return { agents: await listChannelAgents(channelOrNotFound(channel)) }
}

channelRoutes.post('/channels', async (c) => {
  const body = await readBody(c)
  const teamId = await requireTeam(c, body)
  const title = requireText(body.title, 'title', MAX_TITLE_LENGTH)
  const sessionId = randomUUID()

  await upsertConversationShell({
    sessionId,
    userId: c.get('userId'),
    teamId,
    title,
    firstMessage: '',
    kind: 'channel',
  })

  return c.json({ sessionId }, 201)
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
  if (!(await ownsAgent(agentSessionId, userId, teamId)))
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

  if (channel.userId !== userId && !(await ownsAgent(agentSessionId, userId, teamId)))
    throw new AppError(
      403,
      'forbidden',
      'Only the channel owner or the agent’s owner can remove it',
    )

  await removeChannelAgent(channelId, agentSessionId)

  // Nothing back: the agent's owner may not be allowed to see who else is here.
  return c.body(null, 204)
})

// Posting only records the message. Nothing runs here: a channel has no agent of
// its own to answer it.
channelRoutes.post('/conversations/:sessionId/channel-messages', async (c) => {
  const userId = c.get('userId')
  const body = await readBody(c)
  const teamId = await requireTeam(c, body)
  const channel = channelOrNotFound(
    await assertConversationSendable(c.req.param('sessionId'), userId, teamId),
  )
  const text = requireText(body.text, 'text', MAX_MESSAGE_LENGTH)
  // A client id makes a resend the same message; the transcript skips ids it has.
  const id = typeof body.id === 'string' && body.id.length <= 100 ? body.id : randomUUID()
  const metadata = await createMessageMetadata(
    userId,
    'nuphos',
    c.req.header('X-Nuphos-Device-Id')?.trim() || undefined,
    c.get('cliToken'),
  )

  await appendConversationMessages({
    sessionId: channel.sessionId,
    userId: channel.userId,
    teamId,
    messages: [{ id, role: 'user', parts: [{ type: 'text', text }], metadata }],
  })
  // Speaking in a channel is joining it, as it is anywhere else.
  if (userId !== channel.userId) await addConversationParticipants(channel.sessionId, [userId])

  return c.json({ id }, 201)
})
