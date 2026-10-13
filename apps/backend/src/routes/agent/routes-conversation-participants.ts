import { Hono } from 'hono'

import { getReadableConversation } from '@/lib/agent/db'
import {
  GENERAL_ACCESS_VALUES,
  PARTICIPANT_ROLES,
  generalAccessOf,
  participantRole,
} from '@/lib/agent/db/access'
import {
  conversationParticipantIds,
  inviteConversationParticipants,
  removeConversationParticipant,
  setGeneralAccess,
  setParticipantRole,
} from '@/lib/agent/db/participants'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { buildConversationOwnerMap } from './conversation-view'
import {
  assertConversationWritable,
  readTeamIdCandidate,
  resolveVerifiedTeamId,
} from './team-scope'

import type { GeneralAccess, ParticipantRole } from '@/lib/agent/db/access'

import type { AgentConversation } from '@/lib/agent/db'
import type { AuthVariables } from '@/middleware/auth'

// Its own sub-router rather than a registration on the shared `agent` router,
// so a test can mount it behind its own auth without the whole agent surface.
export const conversationParticipantsRoutes = new Hono<{ Variables: AuthVariables }>()

const MAX_INVITES_PER_REQUEST = 20

async function serializeAccess(
  conversation: Pick<
    AgentConversation,
    'userId' | 'participantIds' | 'viewOnlyIds' | 'managerIds' | 'generalAccess'
  >,
  teamId: string | undefined,
) {
  const ids = conversationParticipantIds(conversation)
  const byId = await buildConversationOwnerMap(teamId, ids)

  return {
    generalAccess: generalAccessOf(conversation),
    participants: ids.map((id) => {
      const resolved = byId.get(id)
      const isOwner = id === conversation.userId

      return {
        ...(resolved ?? { id, name: 'Unknown user', email: '', avatarURL: '' }),
        isOwner,
        role: isOwner ? 'owner' : participantRole(conversation, id),
      }
    }),
  }
}

function readRole(value: unknown): ParticipantRole {
  if (value === undefined) return 'reply'
  if (!PARTICIPANT_ROLES.includes(value as ParticipantRole))
    throw new AppError(400, 'invalid_request', 'role must be "view", "reply" or "manage"')

  return value as ParticipantRole
}

/** Every change to who may be here is the owner's, so the gate is the owner gate. */
async function requireOwnedConversation(sessionId: string, userId: string, teamId: string) {
  const conversation = await assertConversationWritable(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')

  return conversation
}

// Gated on reading, not sending: anyone who may view the conversation sees who
// is in it.
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

  return c.json(await serializeAccess(conversation, teamId))
})

// Inviting is a grant: the invitee may read, and reply unless invited to view.
// Re-inviting someone sets their role.
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
  const role = readRole(body.role)
  const conversation = await requireOwnedConversation(sessionId, userId, teamId)
  const invitees = userIds.filter((id) => id !== conversation.userId)
  // A private conversation is worth nothing shared with someone who cannot open
  // it, so an invitee outside the team is a request error, not a silent no-op.
  const memberships = await Promise.all(
    invitees.map(async (id) => ({ id, membership: await getTeamMembership(id, teamId) })),
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
  const updated = await inviteConversationParticipants(sessionId, userId, invitees, role)

  if (!updated) throw new AppError(404, 'not_found', 'Conversation not found')

  return c.json(await serializeAccess(updated, teamId))
})

// The invite's mirror image: removing revokes the person's own grant. They keep
// whatever general access still gives the team. The owner cannot be removed.
conversationParticipantsRoutes.delete(
  '/conversations/:sessionId/participants/:userId',
  async (c) => {
    const sessionId = c.req.param('sessionId')
    const targetId = c.req.param('userId')
    const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))

    if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')
    const conversation = await requireOwnedConversation(sessionId, c.get('userId'), teamId)

    if (targetId === conversation.userId)
      throw new AppError(400, 'invalid_request', 'The conversation owner cannot be removed')
    const updated = await removeConversationParticipant(sessionId, c.get('userId'), targetId)

    if (!updated) throw new AppError(404, 'not_found', 'Conversation not found')

    return c.json(await serializeAccess(updated, teamId))
  },
)

conversationParticipantsRoutes.patch(
  '/conversations/:sessionId/participants/:userId',
  async (c) => {
    const sessionId = c.req.param('sessionId')
    const targetId = c.req.param('userId')
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))

    if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')
    const role = readRole(body.role)
    const conversation = await requireOwnedConversation(sessionId, c.get('userId'), teamId)

    if (!participantRole(conversation, targetId))
      throw new AppError(404, 'not_found', 'That person is not in this conversation')
    const updated = await setParticipantRole(sessionId, [targetId], role)

    if (!updated) throw new AppError(404, 'not_found', 'Conversation not found')

    return c.json(await serializeAccess(updated, teamId))
  },
)

conversationParticipantsRoutes.patch('/conversations/:sessionId/access', async (c) => {
  const sessionId = c.req.param('sessionId')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))

  if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')
  const generalAccess = body.generalAccess as GeneralAccess

  if (!GENERAL_ACCESS_VALUES.includes(generalAccess))
    throw new AppError(400, 'invalid_request', 'generalAccess must be "none", "view" or "reply"')
  await requireOwnedConversation(sessionId, c.get('userId'), teamId)
  const updated = await setGeneralAccess(sessionId, generalAccess)

  if (!updated) throw new AppError(404, 'not_found', 'Conversation not found')

  return c.json(await serializeAccess(updated, teamId))
})
