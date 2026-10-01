import { Check, Loader2, X } from 'lucide-react'

import { Avatar } from './Avatar'

import type { DiscoverableTeam, TeamInvitation } from '../types'

/*
 * Shared "pending invitations" card list — the single source of the invitation
 * experience. The onboarding workspace step embeds it in deferred-commit mode
 * for teamless users, and TeamInvitationsTakeover surfaces the same cards in
 * immediate mode to signed-in users with teams.
 */

/** Deferred-commit mode (onboarding's pick screen): cards only toggle a
 *  selection and the caller joins everything at once on Continue, so a click
 *  never does anything irreversible. Omit for immediate mode (takeover,
 *  sidebar), where Accept/Reject/Join act on click. */
type InvitationSelection = {
  invitationIds: ReadonlySet<string>
  teamIds: ReadonlySet<string>
  /** True while the caller is committing the selection; locks the toggles. */
  committing: boolean
  onToggleInvitation: (invitation: TeamInvitation) => void
  onToggleTeam: (team: DiscoverableTeam) => void
}

type InvitationListProps = {
  invitations: TeamInvitation[]
  /** Workspaces open to the user's email domain; omit to hide the section. */
  discoverableTeams?: DiscoverableTeam[]
  /** Teams already joined in this sitting — their cards flip to "Joined". */
  joinedTeamIds: ReadonlySet<string>
  actingInvitationId: string | null
  joiningTeamId?: string | null
  onAcceptInvitation?: (invitationId: string) => void
  onRejectInvitation?: (invitationId: string) => void
  onJoinDiscoverableTeam?: (team: DiscoverableTeam) => void
  selection?: InvitationSelection
  /** Card surface: 'stage' is the onboarding panel's frosted 2xl card;
   *  'modal' matches the tighter card idiom used inside Modal/popover
   *  surfaces (SidebarInvitations, TeamMembersView). */
  variant?: 'stage' | 'modal'
}

function JoinedChip() {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-md border border-zViolet-500/35 bg-zViolet-500/10 px-2.5 text-[12.5px] font-medium text-zViolet-300">
      <Check className="h-3 w-3" />
      Joined
    </span>
  )
}

function SelectToggle({
  selected,
  pending,
  disabled,
  onToggle,
}: {
  selected: boolean
  /** This card's join is the one currently in flight during the commit. */
  pending: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={
        selected
          ? 'titlebar-no-drag inline-flex h-8 items-center gap-1 rounded-md border border-zViolet-500/35 bg-zViolet-500/10 px-2.5 text-[12.5px] font-medium text-zViolet-300 transition-colors hover:bg-zViolet-500/20 disabled:cursor-default disabled:opacity-60'
          : 'titlebar-no-drag inline-flex h-8 items-center gap-1 rounded-md bg-zViolet-500 px-2.5 text-[12.5px] font-medium text-white transition-colors hover:bg-zViolet-400 disabled:cursor-default disabled:opacity-60'
      }
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        selected && <Check className="h-3 w-3" />
      )}
      {selected ? 'Selected' : 'Join'}
    </button>
  )
}

export function InvitationList({
  invitations,
  discoverableTeams = [],
  joinedTeamIds,
  actingInvitationId,
  joiningTeamId = null,
  onAcceptInvitation,
  onRejectInvitation,
  onJoinDiscoverableTeam,
  selection,
  variant = 'stage',
}: InvitationListProps) {
  const busy =
    actingInvitationId !== null || joiningTeamId !== null || Boolean(selection?.committing)
  // Section labels only earn their keep when both groups are present.
  const showSectionLabels = invitations.length > 0 && discoverableTeams.length > 0
  const cardClass =
    variant === 'modal'
      ? 'flex items-center gap-3 rounded-lg border border-zGray-800 bg-zGray-850 px-3 py-2.5'
      : 'flex items-center gap-3 rounded-2xl border border-zGray-800/80 bg-zGray-900/60 px-4 py-3 backdrop-blur'

  return (
    <>
      {showSectionLabels && (
        <div className="px-1 pb-0.5 text-[11.5px] text-tertiary">Invitations</div>
      )}
      {invitations.map((invitation) => {
        const joined = joinedTeamIds.has(invitation.teamId)

        return (
          <div key={invitation.id} className={cardClass}>
            <Avatar
              src={invitation.team?.avatarUrl}
              name={invitation.team?.name ?? 'Team invitation'}
              size={28}
              className="rounded-md !shadow-none"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-main">
                {invitation.team?.name ?? 'Team invitation'}
              </div>
              <div className="truncate text-[12px] text-tertiary">
                Invitation for {invitation.inviteeEmail}
              </div>
            </div>
            {joined ? (
              <JoinedChip />
            ) : selection ? (
              <SelectToggle
                selected={selection.invitationIds.has(invitation.id)}
                pending={actingInvitationId === invitation.id}
                disabled={busy}
                onToggle={() => selection.onToggleInvitation(invitation)}
              />
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRejectInvitation?.(invitation.id)}
                  className="titlebar-no-drag inline-flex h-8 items-center gap-1 rounded-md border border-zGray-700 px-2.5 text-[12.5px] font-medium text-secondary transition-colors hover:bg-zGray-800/70 hover:text-main disabled:cursor-default disabled:opacity-60"
                >
                  <X className="h-3 w-3" />
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAcceptInvitation?.(invitation.id)}
                  className="titlebar-no-drag inline-flex h-8 items-center gap-1 rounded-md bg-zViolet-500 px-2.5 text-[12.5px] font-medium text-white transition-colors hover:bg-zViolet-400 disabled:cursor-default disabled:opacity-60"
                >
                  {actingInvitationId === invitation.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Accept
                </button>
              </>
            )}
          </div>
        )
      })}
      {showSectionLabels && (
        <div className="px-1 pb-0.5 pt-2 text-[11.5px] text-tertiary">Teams you can join</div>
      )}
      {discoverableTeams.map((team) => {
        const joined = joinedTeamIds.has(team.id)

        return (
          <div key={team.id} className={cardClass}>
            <Avatar
              src={team.avatarUrl}
              name={team.name}
              size={28}
              className="rounded-md !shadow-none"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-main">{team.name}</div>
              <div className="truncate text-[12px] text-tertiary">
                {team.memberCount === 1 ? '1 member' : `${String(team.memberCount)} members`}
                {' · your email domain'}
              </div>
            </div>
            {joined ? (
              <JoinedChip />
            ) : selection ? (
              <SelectToggle
                selected={selection.teamIds.has(team.id)}
                pending={joiningTeamId === team.id}
                disabled={busy}
                onToggle={() => selection.onToggleTeam(team)}
              />
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => onJoinDiscoverableTeam?.(team)}
                className="titlebar-no-drag inline-flex h-8 items-center gap-1 rounded-md bg-zViolet-500 px-2.5 text-[12.5px] font-medium text-white transition-colors hover:bg-zViolet-400 disabled:cursor-default disabled:opacity-60"
              >
                {joiningTeamId === team.id && <Loader2 className="h-3 w-3 animate-spin" />}
                Join
              </button>
            )}
          </div>
        )
      })}
    </>
  )
}
