import { Hono } from 'hono'

import { getReadableConversation } from '@/lib/agent/db'
import {
  addConversationParticipants,
  conversationParticipantIds,
} from '@/lib/agent/db/participants'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { buildConversationOwnerMap } from './conversation-view'
import {
  assertConversationSendable,
  readTeamIdCandidate,
  resolveVerifiedTeamId,
} from './team-scope'

import type { AgentConversation } from '@/lib/agent/db'
import type { AuthVariables } from '@/middleware/auth'

// Its own sub-router rather than a registration on the shared `agent` router,
// so a test can mount it behind its own auth without the whole agent surface.
export const conversationParticipantsRoutes = new Hono<{ Variables: AuthVariables }>()

const MAX_INVITES_PER_REQUEST = 20

async function serializeParticipants(
  conversation: Pick<AgentConversation, 'userId' | 'participantIds'>,
  teamId: string | undefined,
) {
  const ids = conversationParticipantIds(conversation)
  const byId = await buildConversationOwnerMap(teamId, ids)

  return ids.map((id) => {
    const resolved = byId.get(id)

    return {
      ...(resolved ?? { id, name: 'Unknown user', email: '', avatarURL: '' }),
      isOwner: id === conversation.userId,
    }
  })
}

// Readable, not sendable: a teammate who may only view the conversation (e.g.
// it runs on the owner's Local Agent) still sees who is in it.
//
// The team scope has to be refused explicitly rather than left undefined:
// `getReadableConversation` reads undefined as "my own conversations only", so
// a missing or unverifiable teamId would quietly 404 a teammate who is in fact
// allowed to read this. Same contract as the model-config routes.
conversationParticipantsRoutes.get('/conversations/:sessionId/participants', async (c) => {
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))

  if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')
  const conversation = await getReadableConversation(sessionId, c.get('userId'), teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')

  return c.json({ participants: await serializeParticipants(conversation, teamId) })
})

// Inviting grants nothing — every member of the team can already read and send
// here. It records that the invitee belongs in this conversation, which is what
// puts them in the header and tells the agent who it is talking to. The gate is
// therefore the send gate: whoever may take part may bring someone in.
conversationParticipantsRoutes.post('/conversations/:sessionId/participants', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))

  if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')
  const userIds = Array.isArray(body.userIds)
    ? Array.from(
        new Set(body.userIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
      )
    : null

  if (!userIds?.length) {
    throw new AppError(400, 'invalid_request', 'userIds must be a non-empty array of user ids')
  }
  if (userIds.length > MAX_INVITES_PER_REQUEST) {
    throw new AppError(
      400,
      'invalid_request',
      `userIds may contain at most ${String(MAX_INVITES_PER_REQUEST)} ids`,
    )
  }
  const conversation = await assertConversationSendable(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  // A private conversation is worth nothing shared with someone who cannot open
  // it, so an invitee outside the team is a request error, not a silent no-op.
  const memberships = await Promise.all(
    userIds.map(async (id) => ({ id, membership: await getTeamMembership(id, teamId) })),
  )
  const outsiders = memberships.filter((entry) => !entry.membership).map((entry) => entry.id)

  if (outsiders.length > 0) {
    throw new AppError(
      403,
      'not_team_member',
      'Every invitee must be a current member of this conversation’s team',
    )
  }
  // Render the post-write document rather than a locally merged copy, so a
  // simultaneous invite from someone else is already reflected in the answer.
  const updated = await addConversationParticipants(sessionId, userIds)

  if (!updated) throw new AppError(404, 'not_found', 'Conversation not found')

  return c.json({ participants: await serializeParticipants(updated, teamId) })
})
