import { MongoServerError, ObjectId } from 'mongodb'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import {
  INVITATION_RESEND_MS,
  inviteLandingUrl,
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
  // Who invites chooses what they join as; Editor, as before, when a client does not say.
  role: z.enum(['ADMINISTRATOR', 'EDITOR', 'VIEWER']).default('EDITOR'),
})

export function registerTeamInvitationRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  teamScoped.get('/invitations', async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const invitations = await teamInvitations()
      .find({ teamId })
      .sort({ invitedAt: -1 })
      .limit(200)
      .toArray()

    // The link is for an admin to send another way; members see the list without it.
    const inviteUrl =
      c.get('teamRole') === 'ADMINISTRATOR' ? inviteLandingUrl(c.get('team').name) : undefined

    return c.json({
      invitations: invitations.map((invitation) =>
        serializeTeamInvitation(invitation, undefined, inviteUrl),
      ),
    })
  })

  teamScoped.post(
    '/invitations',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', createInvitationSchema),
    async (c) => {
      const { inviteeEmail, role } = c.req.valid('json')
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
        role,
        // Claimed as sent before sending, as a resend does, so Resend waits only after an email.
        lastSentAt: now,
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

      if (!emailSent)
        await teamInvitations().updateOne(
          { _id: invitation._id, lastSentAt: now },
          { $unset: { lastSentAt: '' } },
        )

      return c.json(
        {
          invitation: serializeTeamInvitation(
            invitation,
            undefined,
            inviteLandingUrl(c.get('team').name),
          ),
          emailSent,
        },
        201,
      )
    },
  )

  // Sends a pending invitation's email again, at most once per INVITATION_RESEND_MS.
  teamScoped.post(
    '/invitations/:invitationId/resend',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const invitationId = c.req.param('invitationId')

      if (!ObjectId.isValid(invitationId))
        throw new AppError(400, 'invalid_id', `Invalid invitationId: ${invitationId}`)
      const pending = {
        _id: new ObjectId(invitationId),
        teamId: parseObjectId(c.get('teamId'), 'teamId'),
        acceptedAt: { $exists: false },
        rejectedAt: { $exists: false },
      }
      const now = new Date()
      const cutoff = new Date(now.getTime() - INVITATION_RESEND_MS)
      // Claimed before sending, so two clicks on two replicas send one email.
      const invitation = await teamInvitations().findOneAndUpdate(
        {
          ...pending,
          // Unset means no email has gone out yet.
          $or: [{ lastSentAt: { $exists: false } }, { lastSentAt: { $lt: cutoff } }],
        },
        { $set: { lastSentAt: now } },
        { returnDocument: 'before' },
      )

      if (!invitation) {
        const exists = await teamInvitations().findOne(pending)

        if (!exists) throw new AppError(404, 'invitation_not_found', 'Invitation not found')
        throw new AppError(
          429,
          'resend_too_soon',
          'This invitation was just sent. Try again in a few minutes.',
        )
      }
      const previousSentAt = invitation.lastSentAt
      const team = c.get('team').name
      const emailSent = await sendTeamInvitationEmail({
        to: invitation.inviteeEmail,
        teamName: team,
        inviterName: c.get('userName') ?? '',
      })

      // No email went out, so nothing was "just sent": the next try is not held back.
      if (!emailSent)
        await teamInvitations().updateOne(
          { _id: invitation._id, lastSentAt: now },
          previousSentAt
            ? { $set: { lastSentAt: previousSentAt } }
            : { $unset: { lastSentAt: '' } },
        )

      return c.json({
        invitation: serializeTeamInvitation(invitation, undefined, inviteLandingUrl(team)),
        emailSent,
      })
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
