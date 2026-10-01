import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api, parseAtlasError } from '../api'
import { ContextMenu } from '../components/ContextMenu'
import { PageHeader } from '../components/PageHeader'
import { Table } from '../components/Table'
import { SearchBox } from '../components/Toolbar'
import { useReportLoading } from '../components/useReportLoading'
import { useToolbarPrimaryAction } from '../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { InviteMemberModal } from './members/InviteMemberModal'
import { buildMemberColumns } from './members/memberColumns'
import { applyFilter } from './members/memberRows'
import { useMemberActions } from './members/useMemberActions'
import { useResetOnKey } from './useResetOnKey'

import type { TeamInvitation, TeamMember } from '../types'
import type { MemberRow } from './members/memberRows'

type Props = {
  teamId: string
  currentUserId: string
  /**
   * Filter driven by the shared toolbar. Omit it when there is no toolbar to
   * drive it — inside the Settings overlay the main shell is hidden, so the
   * view falls back to its own search box in the header.
   */
  filter?: string
  refreshKey: number
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function TeamMembersView({
  teamId,
  currentUserId,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: Props) {
  const [internalFilter, setInternalFilter] = useState('')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<TeamInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [menuState, setMenuState] = useState<{ row: MemberRow; x: number; y: number } | null>(null)
  const [actingRowKey, setActingRowKey] = useState<string | null>(null)

  useReportLoading(loading, onLoading)

  useResetOnKey(`${teamId}|${String(refreshKey)}`, () => {
    setLoading(true)
    setError(null)
  })

  useEffect(() => {
    let cancelled = false

    Promise.all([api.atlasListTeamMembers(teamId), api.atlasListTeamInvitations(teamId)])
      .then(([memberItems, invitationItems]) => {
        if (cancelled) return
        setMembers(memberItems)
        setInvitations(invitationItems)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(parseAtlasError(e).message)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [teamId, refreshKey])

  const rows = useMemo<MemberRow[]>(() => {
    const memberRows = members.map<MemberRow>((member) => ({ kind: 'member', member }))
    const memberEmails = new Set(members.map((member) => member.email.toLowerCase()))
    const invitationRows = invitations
      .filter((invitation) => !invitation.acceptedAt && !invitation.rejectedAt)
      .filter((invitation) => !memberEmails.has(invitation.inviteeEmail.toLowerCase()))
      .map<MemberRow>((invitation) => ({ kind: 'invitation', invitation }))

    return [...memberRows, ...invitationRows]
  }, [members, invitations])

  const effectiveFilter = filter ?? internalFilter
  const filtered = useMemo(() => applyFilter(rows, effectiveFilter), [rows, effectiveFilter])
  const currentMember = useMemo(
    () => members.find((member) => member.id === currentUserId),
    [currentUserId, members],
  )
  const canManageMembers = currentMember?.role === 'ADMINISTRATOR'

  // Two hosts for this view:
  //   • the workspace shell (a `filter` prop is passed) — the title/subtitle and
  //     search now live in the shared toolbar, so we drop the PageHeader and
  //     publish "Invite" as the toolbar's primary action;
  //   • the Settings overlay (`filter === undefined`, no toolbar) — keep the
  //     PageHeader with its own search box and inline Invite button.
  const inWorkspaceShell = filter !== undefined
  const { isActive } = useWorkspaceTab()

  useToolbarPrimaryAction(inWorkspaceShell && isActive && canManageMembers ? 'Invite' : null, () =>
    setInviteOpen(true),
  )

  useEffect(() => {
    onCount?.(filtered.length)
  }, [filtered.length, onCount])

  const { submitInvite, buildRowMenu } = useMemberActions({
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
  })

  return (
    <div className="h-full flex flex-col bg-main">
      {!inWorkspaceShell && (
        // Settings overlay has no toolbar; mirror the workspace's two rows — a
        // titled header, then a controls row (search left, Invite right).
        <>
          <PageHeader title="Members" subtitle="Invite teammates and review workspace access" />
          <div className="flex h-[42px] flex-shrink-0 items-center gap-2 border-b border-zGray-800/60 px-6">
            <SearchBox
              filter={internalFilter}
              onFilterChange={setInternalFilter}
              count={filtered.length}
            />
            <div className="flex-1" />
            {canManageMembers && (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="h-8 px-3 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                Invite
              </button>
            )}
          </div>
        </>
      )}
      {error ? (
        <div className="p-8 text-error text-[13px]">{error}</div>
      ) : (
        <>
          <Table<MemberRow>
            loading={loading}
            rows={filtered}
            rowKey={(row) =>
              row.kind === 'member' ? row.member.id : `invitation:${row.invitation.id}`
            }
            storageKey="team.members"
            defaultSort={{ key: 'name', dir: 'asc' }}
            empty="No members"
            onRowContextMenu={
              canManageMembers
                ? (row, e) => {
                    setMenuState({ row, x: e.clientX, y: e.clientY })
                  }
                : undefined
            }
            columns={buildMemberColumns()}
          />
          {menuState && (
            <ContextMenu
              x={menuState.x}
              y={menuState.y}
              items={buildRowMenu(menuState.row)}
              onClose={() => setMenuState(null)}
            />
          )}
        </>
      )}

      <InviteMemberModal
        open={inviteOpen}
        submitting={inviteSubmitting}
        email={inviteEmail}
        onEmailChange={setInviteEmail}
        onClose={() => setInviteOpen(false)}
        onSubmit={(e) => void submitInvite(e)}
      />
    </div>
  )
}
