import { ShieldCheck, UserMinus, XCircle } from 'lucide-react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'

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
      toast.success('Invitation sent', email)
      // The invitation exists at this point — a refresh failure must not read
      // as "invite failed" (which would invite a duplicate retry).
      try {
        setInvitations(await api.atlasListTeamInvitations(teamId))
      } catch (refreshErr) {
        toast.apiError('Invitation sent, but list refresh failed', refreshErr)
      }
    } catch (err) {
      toast.apiError('Invite failed', err)
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
        toast.apiError('Invitation cancelled, but list refresh failed', refreshErr)
      }
    } catch (err) {
      toast.apiError('Cancel invite failed', err)
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
        toast.apiError('Member removed, but list refresh failed', refreshErr)
      }
    } catch (err) {
      toast.apiError('Remove member failed', err)
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
      toast.apiError('Role change failed', err)
    } finally {
      setActingRowKey(null)
    }
  }

  function buildRowMenu(row: MemberRow): ContextMenuItem[] {
    if (row.kind === 'invitation') {
      return [
        {
          key: 'cancel-invite',
          label: 'Cancel invite',
          icon: XCircle,
          destructive: true,
          disabled: actingRowKey === `invitation:${row.invitation.id}`,
          confirm: `Cancel invitation for ${row.invitation.inviteeEmail}?`,
          onSelect: () => cancelInvitation(row.invitation),
        },
      ]
    }

    const isSelf = row.member.id === currentUserId
    const roleItems: ContextMenuItem[] = (['ADMINISTRATOR', 'EDITOR', 'VIEWER'] as const)
      .filter((role) => role !== row.member.role)
      .map((role) => ({
        key: `role-${role}`,
        label: `Make ${roleLabel(role)}`,
        icon: ShieldCheck,
        disabled: isSelf || actingRowKey === row.member.id,
        hint: isSelf ? 'you' : undefined,
        confirm: `Change ${row.member.name || row.member.email} to ${roleLabel(role)}?`,
        onSelect: () => updateMemberRole(row.member, role),
      }))

    return [
      ...roleItems,
      ...(roleItems.length > 0 ? [{ key: 'sep-role', separator: true } as ContextMenuItem] : []),
      {
        key: 'remove-member',
        label: 'Remove from team',
        icon: UserMinus,
        destructive: true,
        disabled: isSelf || actingRowKey === row.member.id,
        hint: isSelf ? 'you' : undefined,
        confirm: `Remove ${row.member.name || row.member.email} from this team?`,
        onSelect: () => removeMember(row.member),
      },
    ]
  }

  return { submitInvite, buildRowMenu }
}
