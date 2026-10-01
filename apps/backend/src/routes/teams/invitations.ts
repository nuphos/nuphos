import { MongoServerError, ObjectId } from 'mongodb'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import {
  normalizeInviteeEmail,
  sendTeamInvitationEmail,
  serializeTeamInvitation,
} from '@/lib/team-invitations'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamInvitations } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { TeamInvitation } from '@/models'
import type { Hono } from 'hono'

const createInvitationSchema = z.object({
  inviteeEmail: z.string().email().transform(normalizeInviteeEmail),
})

export function registerTeamInvitationRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  teamScoped.get('/invitations', async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const invitations = await teamInvitations()
      .find({ teamId })
      .sort({ invitedAt: -1 })
      .limit(200)
      .toArray()

    return c.json({
      invitations: invitations.map((invitation) => serializeTeamInvitation(invitation)),
    })
  })

  teamScoped.post(
    '/invitations',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', createInvitationSchema),
    async (c) => {
      const { inviteeEmail } = c.req.valid('json')
      const teamId = parseObjectId(c.get('teamId'), 'teamId')

      const existing = await teamInvitations().findOne({
        teamId,
        inviteeEmail,
        acceptedAt: { $exists: false },
        rejectedAt: { $exists: false },
      })

      if (existing) {
        throw new AppError(
          409,
          'invitation_already_exists',
          `${inviteeEmail} already has a pending invitation`,
        )
      }

      const now = new Date()
      const invitation: TeamInvitation = {
        _id: new ObjectId(),
        inviterId: parseObjectId(c.get('userId'), 'userId'),
        teamId,
        invitedAt: now,
        inviteeEmail,
      }

      try {
        await teamInvitations().insertOne(invitation)
      } catch (err) {
        if (err instanceof MongoServerError && err.code === 11000) {
          throw new AppError(
            409,
            'invitation_already_exists',
            `${inviteeEmail} already has a pending invitation`,
          )
        }
        throw err
      }

      // Notify the invitee by email. sendTeamInvitationEmail is fail-soft (never
      // throws): the invitation record is already committed and visible in-app on
      // sign-in, so a delivery failure — or email being unconfigured — is logged
      // internally and reported via emailSent, never failing the request. The
      // team is already resolved on the context by requireTeamMember (no extra
      // query).
      const emailSent = await sendTeamInvitationEmail({
        to: inviteeEmail,
        teamName: c.get('team').name,
        inviterName: c.get('userName') ?? '',
      })

      return c.json({ invitation: serializeTeamInvitation(invitation), emailSent }, 201)
    },
  )

  teamScoped.delete('/invitations/:invitationId', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const invitationId = c.req.param('invitationId')

    if (!ObjectId.isValid(invitationId)) {
      throw new AppError(400, 'invalid_id', `Invalid invitationId: ${invitationId}`)
    }

    const rejectedAt = new Date()
    const invitation = await teamInvitations().findOneAndUpdate(
      {
        _id: new ObjectId(invitationId),
        teamId: parseObjectId(c.get('teamId'), 'teamId'),
        acceptedAt: { $exists: false },
        rejectedAt: { $exists: false },
      },
      { $set: { rejectedAt } },
      { returnDocument: 'after' },
    )

    if (!invitation) {
      throw new AppError(404, 'invitation_not_found', 'Invitation not found')
    }

    return c.json({ invitation: serializeTeamInvitation(invitation) })
  })
}
