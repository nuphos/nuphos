import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { addUserToTeam, getTeamsByIds } from '@/lib/identity'
import { normalizeInviteeEmail, serializeTeamInvitation } from '@/lib/team-invitations'
import { requireAuth } from '@/middleware/auth'
import { teamInvitations } from '@/models'

import type { AuthVariables } from '@/middleware/auth'

export const invitationsRoutes = new Hono<{ Variables: AuthVariables }>()
invitationsRoutes.use('*', requireAuth)

invitationsRoutes.get('/', async (c) => {
  const inviteeEmail = normalizeInviteeEmail(c.get('userEmail'))
  const invitations = await teamInvitations()
    .find({ inviteeEmail })
    .sort({ invitedAt: -1 })
    .limit(200)
    .toArray()
  const teamIds = invitations.map((invitation) => invitation.teamId.toHexString())
  const teams = await getTeamsByIds(teamIds)
  const teamsById = new Map(teams.map((team) => [team.id, team]))

  return c.json({
    invitations: invitations.map((invitation) =>
      serializeTeamInvitation(invitation, teamsById.get(invitation.teamId.toHexString())),
    ),
  })
})

invitationsRoutes.post('/:invitationId/accept', async (c) => {
  const invitationId = c.req.param('invitationId')

  if (!ObjectId.isValid(invitationId)) {
    throw new AppError(400, 'invalid_id', `Invalid invitationId: ${invitationId}`)
  }

  const inviteeEmail = normalizeInviteeEmail(c.get('userEmail'))
  const acceptedAt = new Date()
  const invitation = await teamInvitations().findOneAndUpdate(
    {
      _id: new ObjectId(invitationId),
      inviteeEmail,
      acceptedAt: { $exists: false },
      rejectedAt: { $exists: false },
    },
    { $set: { acceptedAt } },
    { returnDocument: 'after' },
  )

  if (!invitation) {
    throw new AppError(404, 'invitation_not_found', 'Invitation not found')
  }

  const teamIdStr = invitation.teamId.toHexString()

  const rollbackAcceptedAt = () =>
    teamInvitations().updateOne({ _id: invitation._id, acceptedAt }, { $unset: { acceptedAt: '' } })
  const rollbackAcceptedAtOrThrow = async () => {
    let result

    try {
      result = await rollbackAcceptedAt()
    } catch {
      throw new AppError(
        500,
        'invitation_rollback_failed',
        'Failed to roll back invitation acceptance',
      )
    }
    if (result.modifiedCount !== 1) {
      throw new AppError(
        500,
        'invitation_rollback_failed',
        'Failed to roll back invitation acceptance',
      )
    }
  }

  let added: boolean

  try {
    added = await addUserToTeam(teamIdStr, c.get('userId'), 'EDITOR')
  } catch (e) {
    await rollbackAcceptedAtOrThrow()
    throw e
  }

  if (!added) {
    await rollbackAcceptedAtOrThrow()
    throw new AppError(404, 'team_not_found', 'Team not found')
  }

  return c.json({
    invitation: serializeTeamInvitation(invitation),
  })
})

invitationsRoutes.post('/:invitationId/reject', async (c) => {
  const invitationId = c.req.param('invitationId')

  if (!ObjectId.isValid(invitationId)) {
    throw new AppError(400, 'invalid_id', `Invalid invitationId: ${invitationId}`)
  }

  const inviteeEmail = normalizeInviteeEmail(c.get('userEmail'))
  const rejectedAt = new Date()
  const invitation = await teamInvitations().findOneAndUpdate(
    {
      _id: new ObjectId(invitationId),
      inviteeEmail,
      acceptedAt: { $exists: false },
      rejectedAt: { $exists: false },
    },
    { $set: { rejectedAt } },
    { returnDocument: 'after' },
  )

  if (!invitation) {
    throw new AppError(404, 'invitation_not_found', 'Invitation not found')
  }

  return c.json({
    invitation: serializeTeamInvitation(invitation),
  })
})
