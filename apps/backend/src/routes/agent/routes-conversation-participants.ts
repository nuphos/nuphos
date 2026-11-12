import { Hono } from 'hono'

import { getReadableConversation } from '@/lib/agent/db'
import { generalAccessOf, generalAccessValues } from '@/lib/agent/db/access'
import {
  conversationParticipantIds,
  inviteConversationParticipants,
  removeConversationParticipant,
  setGeneralAccess,
} from '@/lib/agent/db/participants'
import {
  computerUseGap,
  resolveConversationAccess,
} from '@/lib/agent/devices/conversation-computer'
import { addTeamUse } from '@/lib/agent/devices/device-grants'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { buildConversationOwnerMap } from './conversation-view'
import {
  assertConversationWritable,
  readTeamIdCandidate,
  resolveVerifiedTeamId,
} from './team-scope'

import type { GeneralAccess } from '@/lib/agent/db/access'

import type { AgentConversation } from '@/lib/agent/db'
import type { AuthVariables } from '@/middleware/auth'

// Its own sub-router rather than a registration on the shared `agent` router,
// so a test can mount it behind its own auth without the whole agent surface.
export const conversationParticipantsRoutes = new Hono<{ Variables: AuthVariables }>()

const MAX_INVITES_PER_REQUEST = 20

async function serializeAccess(conversation: AgentConversation, teamId: string | undefined) {
  const ids = conversationParticipantIds(conversation)
  const [byId, roles] = await Promise.all([
    buildConversationOwnerMap(teamId, ids),
    Promise.all(ids.map((id) => resolveConversationAccess(conversation, id))),
  ])

  return {
    generalAccess: generalAccessOf(conversation),
    participants: ids.map((id, index) => ({
      ...(byId.get(id) ?? { id, name: 'Unknown user', email: '', avatarURL: '' }),
      isOwner: id === conversation.userId,
      role: roles[index],
    })),
  }
}

/**
 * Taking part means using the conversation's computer, so an invitee who may not
 * use it is refused until the invite confirms giving them `use` on it, which only
 * someone who manages the computer can give. A release that predates the
 * confirmation sends no answer: its invitees join reading only, rather than
 * being refused with an error it cannot show. Returns the grant to make once
 * the invite is written.
 */
async function computerUseToGrant(
  conversation: AgentConversation,
  actorId: string,
  invitees: string[],
  confirmed: boolean | undefined,
): Promise<(() => Promise<void>) | undefined> {
  const gap = await computerUseGap(conversation, actorId, invitees)

  if (!gap || confirmed === undefined) return undefined
  const { computer, needing, canGrant } = gap

  if (!computer || !canGrant)
    throw new AppError(
      403,
      'computer_manage_required',
      'They cannot use the computer this conversation runs on. Ask its owner to give them access first.',
      { userIds: needing },
    )
  if (!confirmed)
    throw new AppError(
      409,
      'computer_use_required',
      `Adding this person to the conversation also gives them use of ${computer.label}. Continue?`,
      { userIds: needing, computer: { deviceId: computer.deviceId, label: computer.label } },
    )

  return async () => {
    if (!(await addTeamUse(computer, conversation.teamId ?? '', needing)))
      throw new AppError(404, 'device_not_found', 'Device is not available')
  }
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

// Inviting is a grant: the invitee may read, and reply on the conversation's
// computer, which they are given `use` of once the invite confirms it.
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
  // Releases that offered roles send one; only reply is left.
  if (body.role !== undefined && body.role !== 'reply')
    throw new AppError(400, 'invalid_request', 'role must be "reply"')
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
  const grant = await computerUseToGrant(
    conversation,
    userId,
    invitees,
    typeof body.grantComputerUse === 'boolean' ? body.grantComputerUse : undefined,
  )
  const updated = await inviteConversationParticipants(sessionId, userId, invitees)

  if (!updated) throw new AppError(404, 'not_found', 'Conversation not found')
  await grant?.()

  return c.json(await serializeAccess(updated, teamId))
})

// The invite's mirror image: removing revokes the person's own grant. They keep
// whatever general access still gives the team. The owner cannot be removed.
// Anyone may remove themselves: that is leaving, and needs no owner.
conversationParticipantsRoutes.delete(
  '/conversations/:sessionId/participants/:userId',
  async (c) => {
    const userId = c.get('userId')
    const sessionId = c.req.param('sessionId')
    const targetId = c.req.param('userId')
    const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))

    if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')
    const conversation =
      targetId === userId
        ? await getReadableConversation(sessionId, userId, teamId)
        : await requireOwnedConversation(sessionId, userId, teamId)

    if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
    if (targetId === conversation.userId)
      throw new AppError(400, 'invalid_request', 'The conversation owner cannot be removed')
    const updated = await removeConversationParticipant(sessionId, userId, targetId)

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
  const conversation = await requireOwnedConversation(sessionId, c.get('userId'), teamId)
  const allowed = generalAccessValues(conversation)

  if (!allowed.includes(generalAccess))
    throw new AppError(
      400,
      'invalid_request',
      `generalAccess must be one of: ${allowed.join(', ')}`,
    )
  const updated = await setGeneralAccess(sessionId, generalAccess)

  if (!updated) throw new AppError(404, 'not_found', 'Conversation not found')

  return c.json(await serializeAccess(updated, teamId))
})
