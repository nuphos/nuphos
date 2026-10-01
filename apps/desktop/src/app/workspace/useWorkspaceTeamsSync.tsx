import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'

import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceProps } from './workspaceProps'
import type { TeamInvitation } from '../../types'

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult &
  WorkspaceTeamsResult

export function useWorkspaceTeamsSync(a: Args) {
  const {
    teams,
    setTeams,
    setPendingInvitations,
    invitationsLoaded,
    setInvitationsLoaded,
    setError,
    teamsLoaded,
    setOnboardingActive,
  } = a
  const refreshTeamsSilently = useCallback(() => {
    api
      .atlasListTeams()
      .then((ts) => setTeams(ts))
      .catch(() => {})
  }, [setTeams])

  // Monotonic token so a slow in-flight refresh can never clobber the state
  // with stale data. Accept/reject bump it too: their authoritative refetch
  // supersedes any background refresh racing alongside — without this, a
  // focus-triggered GET resolving late "resurrects" an invitation the user
  // just accepted, and the takeover re-prompts for it.
  const invitationsFetchTokenRef = useRef(0)
  const applyPendingInvitations = useCallback(
    (invitations: TeamInvitation[]) => {
      setPendingInvitations(
        invitations.filter((invitation) => !invitation.acceptedAt && !invitation.rejectedAt),
      )
    },
    [setPendingInvitations],
  )

  const refreshInvitationsSilently = useCallback(() => {
    const token = ++invitationsFetchTokenRef.current

    api
      .atlasListMyInvitations()
      .then((invitations) => {
        if (token === invitationsFetchTokenRef.current) applyPendingInvitations(invitations)
      })
      // Treat a failed fetch as "no invitations" so a flaky endpoint never
      // blocks a genuinely new user from reaching onboarding.
      .catch(() => {})
      .finally(() => setInvitationsLoaded(true))
  }, [applyPendingInvitations, setInvitationsLoaded])

  useEffect(() => {
    refreshInvitationsSilently()
  }, [refreshInvitationsSilently])

  // Invitations usually arrive while the app is already open (a teammate just
  // clicked Invite), so a mount-only fetch leaves every affordance stale.
  // Refresh on window focus — the "check Nuphos, I invited you" moment — plus
  // a slow poll as a fallback for long-lived unfocused windows.
  useEffect(() => {
    const onFocus = () => refreshInvitationsSilently()

    window.addEventListener('focus', onFocus)
    const interval = window.setInterval(refreshInvitationsSilently, 5 * 60_000)

    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
    }
  }, [refreshInvitationsSilently])

  // Decide once, after BOTH the team list and the pending-invitation list have
  // loaded, whether to drop a teamless account into onboarding. Every teamless
  // account enters — invited users see their pending invitations inside the
  // overlay's workspace step (accept continues the flow from the security
  // briefing), so the intro demo is no longer skipped for them. We still wait
  // for the invitation fetch so the overlay mounts with the invitations in
  // hand. The error string doubles as the dev-dismiss fallback shown behind
  // the (non-dismissible) overlay. Dev-forced sessions (`window.onboarding()`)
  // bypass this entirely.
  // The latch is state rather than a ref so the decision can be made during
  // render: a discarded render must not consume it, and the overlay then mounts
  // in the same frame that completes both fetches instead of one commit later.
  const [onboardingAutoEntryChecked, setOnboardingAutoEntryChecked] = useState(false)

  if (!onboardingAutoEntryChecked && teamsLoaded && invitationsLoaded) {
    setOnboardingAutoEntryChecked(true)
    if (teams.length === 0) {
      setError('No teams are available for this account.')
      setOnboardingActive(true)
    }
  }

  return {
    refreshTeamsSilently,
    invitationsFetchTokenRef,
    applyPendingInvitations,
  }
}

export type WorkspaceTeamsSyncResult = ReturnType<typeof useWorkspaceTeamsSync>
