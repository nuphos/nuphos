import { config } from '@/config'
import { isEmailConfigured, sendEmail } from '@/lib/email'

import type { NuphosTeam } from '@/lib/identity'
import type { TeamInvitation } from '@/models'

export type SerializedTeamInvitation = {
  id: string
  inviterId: string
  teamId: string
  team?: Pick<NuphosTeam, 'id' | 'name' | 'avatarUrl'>
  invitedAt: string
  inviteeEmail: string
  acceptedAt?: string
  rejectedAt?: string
}

export function normalizeInviteeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function serializeTeamInvitation(
  invitation: TeamInvitation,
  team?: Pick<NuphosTeam, 'id' | 'name' | 'avatarUrl'>,
): SerializedTeamInvitation {
  return {
    id: invitation._id.toHexString(),
    inviterId: invitation.inviterId.toHexString(),
    teamId: invitation.teamId.toHexString(),
    ...(team ? { team } : {}),
    invitedAt: invitation.invitedAt.toISOString(),
    inviteeEmail: invitation.inviteeEmail,
    ...(invitation.acceptedAt ? { acceptedAt: invitation.acceptedAt.toISOString() } : {}),
    ...(invitation.rejectedAt ? { rejectedAt: invitation.rejectedAt.toISOString() } : {}),
  }
}

export type TeamInvitationEmailInput = {
  to: string
  teamName: string
  // Display name of the inviting admin. May be empty; the copy adapts.
  inviterName: string
  // Link behind the "Accept invitation" button — the public /invite landing
  // page, which deep-links into the installed app and falls back to the
  // download page. Omitted ⇒ the email renders without a button.
  appUrl?: string
}

// HTML-escape user-controlled strings (team name, inviter name) before
// interpolating them into the email markup so a crafted name can't inject tags.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Pure builder — no config, no network — so the copy/escaping is unit-testable.
export function buildInvitationEmail(input: TeamInvitationEmailInput): {
  subject: string
  html: string
  text: string
} {
  const teamName = input.teamName.trim() || 'a team'
  const inviter = input.inviterName.trim()
  const lead = inviter ? `${inviter} has invited you to join` : `You've been invited to join`
  const appUrl = input.appUrl?.trim() || undefined

  const subject = `You're invited to ${teamName} on Nuphos`
  const button = appUrl
    ? `<a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:8px;padding:11px 20px;background:#1a1a1e;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">Accept invitation</a>`
    : ''
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:32px 16px;background:#f6f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1e">
  <div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e6e6ea">
    <div style="font-size:16px;font-weight:600;margin-bottom:16px">You're invited to Nuphos</div>
    <div style="font-size:14px;color:#55555e;line-height:1.6;margin-bottom:24px">
      ${escapeHtml(lead)} <strong>${escapeHtml(teamName)}</strong> on Nuphos.
      Open Nuphos and sign in with <strong>${escapeHtml(input.to)}</strong> to accept the invitation.
    </div>
    ${button}
    <div style="font-size:12.5px;color:#8a8a94;line-height:1.6;margin-top:24px">
      If you weren't expecting this invitation, you can safely ignore this email.
    </div>
  </div>
</body>
</html>`
  const text =
    `${lead} ${teamName} on Nuphos.\n\n` +
    `Open Nuphos and sign in with ${input.to} to accept the invitation.${
      appUrl ? `\n\n${appUrl}` : ''
    }\n\nIf you weren't expecting this invitation, you can safely ignore this email.`

  return { subject, html, text }
}

// Sends the "you've been invited" email. Fail-soft: this NEVER throws — a
// delivery failure (or email being unconfigured) is logged and reported as a
// false return, because the invitation record is valid without the email (the
// invitee also sees it in-app on sign-in). This differs from OTP, which is
// fail-closed because an undeliverable code is useless. Returns whether an
// email was actually dispatched.
export async function sendTeamInvitationEmail(
  input: Omit<TeamInvitationEmailInput, 'appUrl'>,
): Promise<boolean> {
  if (!isEmailConfigured()) return false
  // The accept button targets the backend's own /invite landing page (see
  // routes/invite-landing.ts): installed apps deep-link open, everyone else
  // gets the download fallback. publicBaseUrl always resolves, so the button
  // is always present; the team name rides along for display only.
  const acceptUrl = new URL(`${config.auth.publicBaseUrl}/invite`)

  if (input.teamName.trim()) acceptUrl.searchParams.set('team', input.teamName.trim())
  const { subject, html, text } = buildInvitationEmail({
    ...input,
    appUrl: acceptUrl.toString(),
  })

  try {
    await sendEmail({ to: input.to, subject, html, text })

    return true
  } catch (err) {
    console.error('team-invitations: failed to send invitation email', err)

    return false
  }
}
