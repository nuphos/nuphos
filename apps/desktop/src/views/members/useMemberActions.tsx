import { Link2, Mail, ShieldCheck, UserMinus, XCircle } from 'lucide-react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { roleLabel } from './memberRows'

import type { MemberRow } from './memberRows'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { TeamInvitation, TeamMember, TeamRole } from '../../types'
import type { FormEvent } from 'react'

type ActionsArgs = {
  teamId: string
  currentUserId: string
  inviteEmail: string
  /** What the invited person joins as. */
  inviteRole: TeamRole
  inviteSubmitting: boolean
  setInviteOpen: React.Dispatch<React.SetStateAction<boolean>>
  setInviteEmail: React.Dispatch<React.SetStateAction<string>>
  setInviteSubmitting: React.Dispatch<React.SetStateAction<boolean>>
  setMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>
  setInvitations: React.Dispatch<React.SetStateAction<TeamInvitation[]>>
  actingRowKey: string | null
  setActingRowKey: React.Dispatch<React.SetStateAction<string | null>>
}

/**
 * An invitation stands even when its email did not go out: say so instead of "sent". An older
 * server sends no link, so there is none to copy from the row.
 */
function announceUnsent(email: string, hasLink: boolean) {
  toast.info(
    t('Invited, but no email went out'),
    hasLink
      ? t(
          'Ask {email} to sign in to Nuphos with this address, or copy the invite link from their row and send it yourself.',
          { email },
        )
      : t('Ask {email} to sign in to Nuphos with this address.', { email }),
  )
}

/** The link holds no secret (invitations follow the invitee's email), so it is safe to share. */
function copyInviteLink(url: string) {
  navigator.clipboard
    .writeText(url)
    .then(() => toast.success(t('Invite link copied'), t('It works for the invited address only.')))
    .catch(() => toast.error(t('Could not copy the link')))
}

export function useMemberActions({
  teamId,
  currentUserId,
  inviteEmail,
  inviteRole,
  inviteSubmitting,
  setInviteOpen,
  setInviteEmail,
  setInviteSubmitting,
  setMembers,
  setInvitations,
  actingRowKey,
  setActingRowKey,
}: ActionsArgs) {
  async function refreshRows() {
    const [memberItems, invitationItems] = await Promise.all([
      api.atlasListTeamMembers(teamId),
      api.atlasListTeamInvitations(teamId),
    ])

    setMembers(memberItems)
    setInvitations(invitationItems)
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault()
    const email = inviteEmail.trim()

    if (!email || inviteSubmitting) return
    setInviteSubmitting(true)
    try {
      const { invitation, emailSent } = await api.atlasInviteTeamMember(teamId, email, inviteRole)

      setInviteOpen(false)
      setInviteEmail('')
      if (emailSent) toast.success(t('Invitation sent'), email)
      else announceUnsent(email, Boolean(invitation.inviteUrl))
      // An older server drops the role it does not know and invites as Editor.
      if (!invitation.role && inviteRole !== 'EDITOR')
        toast.info(
          t('{email} will join as Editor', { email }),
          t(
            'This server is an older version and ignored the role you picked. Change their role after they join.',
          ),
        )
      // The invitation exists at this point — a refresh failure must not read
      // as "invite failed" (which would invite a duplicate retry).
      try {
        setInvitations(await api.atlasListTeamInvitations(teamId))
      } catch (refreshErr) {
        toast.apiError(t('Invitation sent, but list refresh failed'), refreshErr)
      }
    } catch (err) {
      toast.apiError(t('Invite failed'), err)
    } finally {
      setInviteSubmitting(false)
    }
  }

  async function resendInvitation(invitation: TeamInvitation) {
    setActingRowKey(`invitation:${invitation.id}`)
    try {
      const answer = await api.atlasResendTeamInvitation(teamId, invitation.id)

      if (answer.emailSent) toast.success(t('Invitation email sent again'), invitation.inviteeEmail)
      else
        announceUnsent(
          invitation.inviteeEmail,
          Boolean(answer.invitation.inviteUrl ?? invitation.inviteUrl),
        )
    } catch (err) {
      toast.apiError(t('Resend failed'), err)
    } finally {
      setActingRowKey(null)
    }
  }

  async function cancelInvitation(invitation: TeamInvitation) {
    const key = `invitation:${invitation.id}`

    setActingRowKey(key)
    try {
      await api.atlasCancelTeamInvitation(teamId, invitation.id)
      // Mutation succeeded — a refresh failure only means the list is stale.
      try {
        await refreshRows()
      } catch (refreshErr) {
        toast.apiError(t('Invitation cancelled, but list refresh failed'), refreshErr)
      }
    } catch (err) {
      toast.apiError(t('Cancel invite failed'), err)
    } finally {
      setActingRowKey(null)
    }
  }

  async function removeMember(member: TeamMember) {
    const key = member.id

    setActingRowKey(key)
    try {
      await api.atlasRemoveTeamMember(teamId, member.id)
      // Mutation succeeded — a refresh failure only means the list is stale.
      try {
        await refreshRows()
      } catch (refreshErr) {
        toast.apiError(t('Member removed, but list refresh failed'), refreshErr)
      }
    } catch (err) {
      toast.apiError(t('Remove member failed'), err)
    } finally {
      setActingRowKey(null)
    }
  }

  async function updateMemberRole(member: TeamMember, role: TeamRole) {
    const key = member.id

    setActingRowKey(key)
    try {
      const updated = await api.atlasUpdateTeamMemberRole(teamId, member.id, role)

      setMembers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch (err) {
      toast.apiError(t('Role change failed'), err)
    } finally {
      setActingRowKey(null)
    }
  }

  function buildRowMenu(row: MemberRow): ContextMenuItem[] {
    if (row.kind === 'invitation') {
      const busy = actingRowKey === `invitation:${row.invitation.id}`
      const url = row.invitation.inviteUrl

      return [
        {
          key: 'resend-invite',
          label: t('Resend email'),
          icon: Mail,
          disabled: busy,
          onSelect: () => resendInvitation(row.invitation),
        },
        ...(url
          ? [
              {
                key: 'copy-invite',
                label: t('Copy invite link'),
                icon: Link2,
                onSelect: () => copyInviteLink(url),
              },
            ]
          : []),
        { key: 'sep-invite', separator: true } as ContextMenuItem,
        {
          key: 'cancel-invite',
          label: t('Cancel invite'),
          icon: XCircle,
          destructive: true,
          disabled: actingRowKey === `invitation:${row.invitation.id}`,
          confirm: t('Cancel invitation for {email}?', { email: row.invitation.inviteeEmail }),
          // "Cancel invite" beside the dialog's own Cancel would be easy to mix up.
          confirmLabel: t('Withdraw invite'),
          onSelect: () => cancelInvitation(row.invitation),
        },
      ]
    }

    const isSelf = row.member.id === currentUserId
    const roleItems: ContextMenuItem[] = (['ADMINISTRATOR', 'EDITOR', 'VIEWER'] as const)
      .filter((role) => role !== row.member.role)
      .map((role) => ({
        key: `role-${role}`,
        label: t('Make {role}', { role: roleLabel(role) }),
        icon: ShieldCheck,
        disabled: isSelf || actingRowKey === row.member.id,
        hint: isSelf ? t('you') : undefined,
        confirm: t('Change {name} to {role}?', {
          name: row.member.name || row.member.email,
          role: roleLabel(role),
        }),
        onSelect: () => updateMemberRole(row.member, role),
      }))

    return [
      ...roleItems,
      ...(roleItems.length > 0 ? [{ key: 'sep-role', separator: true } as ContextMenuItem] : []),
      {
        key: 'remove-member',
        label: t('Remove from team'),
        icon: UserMinus,
        destructive: true,
        disabled: isSelf || actingRowKey === row.member.id,
        hint: isSelf ? t('you') : undefined,
        confirm: t(
          'Remove {name} from this team? They lose its chats. Computers they share here stop being shared, so teammates’ chats on them stop working. The computers they added from Nuphos here go to the team owner, and anything they have open on teammates’ computers closes.',
          { name: row.member.name || row.member.email },
        ),
        onSelect: () => removeMember(row.member),
      },
    ]
  }

  return { submitInvite, buildRowMenu }
}
