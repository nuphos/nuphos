// Inviting someone to a team, and sending their invitation again. Apart from teams.ts, which is
// at its size limit.
import { call } from './client'

import type { TeamInvitation } from './teams'

type TeamRole = NonNullable<TeamInvitation['role']>

/** `emailSent` is false when the email failed or is not set up: the invitation still stands. */
export async function inviteTeamMember(
  teamId: string,
  inviteeEmail: string,
  role: TeamRole = 'EDITOR',
): Promise<{ invitation: TeamInvitation; emailSent: boolean }> {
  const data = await call<{ invitation: TeamInvitation; emailSent?: boolean }>(
    'POST',
    `/teams/${teamId}/invitations`,
    { inviteeEmail, role },
    { retry: false },
  )

  return { invitation: data.invitation, emailSent: data.emailSent !== false }
}

export async function resendTeamInvitation(
  teamId: string,
  invitationId: string,
): Promise<{ invitation: TeamInvitation; emailSent: boolean }> {
  const data = await call<{ invitation: TeamInvitation; emailSent: boolean }>(
    'POST',
    `/teams/${teamId}/invitations/${invitationId}/resend`,
    undefined,
    { retry: false },
  )

  return { invitation: data.invitation, emailSent: data.emailSent }
}
