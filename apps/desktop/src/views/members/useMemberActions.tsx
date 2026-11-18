import { ShieldCheck, UserMinus, XCircle } from 'lucide-react'

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
  inviteSubmitting: boolean
  setInviteOpen: React.Dispatch<React.SetStateAction<boolean>>
  setInviteEmail: React.Dispatch<React.SetStateAction<string>>
  setInviteSubmitting: React.Dispatch<React.SetStateAction<boolean>>
  setMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>
  setInvitations: React.Dispatch<React.SetStateAction<TeamInvitation[]>>
  actingRowKey: string | null
  setActingRowKey: React.Dispatch<React.SetStateAction<string | null>>
}

export function useMemberActions({
  teamId,
  currentUserId,
  inviteEmail,
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
      await api.atlasInviteTeamMember(teamId, email)
      setInviteOpen(false)
      setInviteEmail('')
      toast.success(t('Invitation sent'), email)
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
      return [
        {
          key: 'cancel-invite',
          label: t('Cancel invite'),
          icon: XCircle,
          destructive: true,
          disabled: actingRowKey === `invitation:${row.invitation.id}`,
          confirm: t('Cancel invitation for {email}?', { email: row.invitation.inviteeEmail }),
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
        confirm: t('Remove {name} from this team?', { name: row.member.name || row.member.email }),
        onSelect: () => removeMember(row.member),
      },
    ]
  }

  return { submitInvite, buildRowMenu }
}
