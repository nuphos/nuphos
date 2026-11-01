import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'

import { selectScope } from './store/workspaceState'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceAccountsResult } from './useWorkspaceAccounts'
import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceAgentLinksResult } from './useWorkspaceAgentLinks'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceNamespacesResult } from './useWorkspaceNamespaces'
import type { WorkspaceScopeActionsResult } from './useWorkspaceScopeActions'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTeamResourcesResult } from './useWorkspaceTeamResources'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceProps } from './workspaceProps'
import type { AtlasTeam, TeamInvitation } from '../../types'

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult &
  WorkspaceTeamsResult &
  WorkspaceInvitationsResult &
  WorkspaceTeamResourcesResult &
  WorkspaceNamespacesResult &
  WorkspaceAccountsResult &
  WorkspaceScopeActionsResult &
  WorkspaceAgentLinksResult

export function useWorkspaceTakeover(a: Args) {
  const paneActive = useWorkspacePane()?.active ?? true
  const {
    teams,
    setTeams,
    teamsLoaded,
    pendingInvitations,
    workspaceStore,
    workspaceActions,
    setError,
    setSettingsOpen,
    setFirstRunDevForced,
    onboardingActive,
    setOnboardingActive,
    setOnboardingForced,
    setLandingCelebration,
    setOnboardingNonce,
    switchTeam,
  } = a

  // --- App-level invitation takeover ---------------------------------------
  // The onboarding pick screen's card flow, for signed-in users who already
  // have teams: pops when pending invitations appear (login, focus refresh,
  // poll), and renders above the main shell.
  // Session-scoped dismissal: "Later" hides the current batch; the sidebar
  // mail button remains the persistent entry point.
  const [invitationTakeoverOpen, setInvitationTakeoverOpen] = useState(false)
  const [takeoverInvitations, setTakeoverInvitations] = useState<TeamInvitation[]>([])
  const [dismissedInvitationIds, setDismissedInvitationIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  // Not a dependency-change reaction but a standing invariant — "unseen
  // invitations and nothing covering the screen means the takeover is open" —
  // so it is evaluated during render rather than from an effect. It settles in
  // one pass: opening the takeover falsifies the guard.
  if (onboardingActive) {
    // Onboarding hosts its own copy of the invitation flow. A takeover that
    // opened in the same pass that decided to auto-enter onboarding would
    // otherwise sit hidden behind the overlay and resurface at landing with a
    // stale snapshot — re-prompting for invitations already handled during
    // onboarding, where accept/reject can only 404.
    if (invitationTakeoverOpen) setInvitationTakeoverOpen(false)
  } else if (!invitationTakeoverOpen && teamsLoaded) {
    const unseen = pendingInvitations.filter(
      (invitation) =>
        !dismissedInvitationIds.has(invitation.id) &&
        // An invitation to a team this account already belongs to (e.g. it
        // stayed pending while the user joined via email-domain discovery) is
        // not actionable — accepting it fails — so never prompt for it. The
        // teamsLoaded gate above keeps this check from running against a
        // not-yet-fetched (empty) team list.
        !teams.some((team) => team.id === invitation.teamId),
    )

    if (unseen.length > 0) {
      setTakeoverInvitations(unseen)
      setInvitationTakeoverOpen(true)
    }
  }

  const closeInvitationTakeover = useCallback(() => {
    setDismissedInvitationIds((prev) => {
      const next = new Set(prev)

      for (const invitation of takeoverInvitations) next.add(invitation.id)

      return next
    })
    setInvitationTakeoverOpen(false)
  }, [takeoverInvitations])

  // Onboarding's pick screen already showed every pending invitation; leaving
  // some un-actioned there is a deliberate skip. Mark them seen when the
  // overlay closes so the takeover doesn't immediately re-prompt for them.
  const markPendingInvitationsSeen = useCallback(() => {
    setDismissedInvitationIds((prev) => {
      if (pendingInvitations.length === 0) return prev
      const next = new Set(prev)

      for (const invitation of pendingInvitations) next.add(invitation.id)

      return next
    })
  }, [pendingInvitations])

  const continueInvitationTakeover = useCallback(
    (teamId: string) => {
      closeInvitationTakeover()
      switchTeam(teamId)
    },
    [closeInvitationTakeover, switchTeam],
  )

  // The active team was deleted (owner) or left (member): drop it from local
  // state, close Settings, and move scope to another team — or fall into the
  // onboarding shell if it was the last one.
  const handleTeamRemoved = useCallback(
    (removedTeamId: string) => {
      setSettingsOpen(false)
      const remaining = teams.filter((team) => team.id !== removedTeamId)

      const wasCurrentTeam = selectScope(workspaceStore.getState())?.teamId === removedTeamId

      setTeams(remaining)
      // Dropping the team's tabs from every session also tears down their SSH
      // sessions: an established connection must not outlive team membership.
      workspaceActions.removeTeam(removedTeamId)
      if (remaining.length === 0) {
        setError(t('No teams are available for this account.'))
        setOnboardingActive(true)

        return
      }
      if (wasCurrentTeam) switchTeam(remaining[0].id)
    },
    [
      teams,
      setSettingsOpen,
      setTeams,
      setError,
      setOnboardingActive,
      switchTeam,
      workspaceActions,
      workspaceStore,
    ],
  )

  // --- Onboarding wiring -------------------------------------------------
  // Create the first workspace and adopt it as the active team. Returns the
  // team so the onboarding flow can keep operating on it for the next step.
  const createWorkspaceForOnboarding = useCallback(
    async (name: string): Promise<AtlasTeam> => {
      const team = await api.atlasCreateTeam(name)

      setTeams((prev) =>
        prev.some((existing) => existing.id === team.id) ? prev : [...prev, team],
      )
      switchTeam(team.id)
      // A new workspace is born — celebrate it. The burst renders in the main
      // shell only, so it plays when the flow finishes and actually lands.
      setLandingCelebration(true)

      return team
    },
    [setTeams, switchTeam, setLandingCelebration],
  )

  const finishOnboarding = useCallback(
    (teamId: string | null) => {
      if (teamId) switchTeam(teamId)
      markPendingInvitationsSeen()
      setOnboardingActive(false)
      setOnboardingForced(false)
    },
    [switchTeam, markPendingInvitationsSeen, setOnboardingActive, setOnboardingForced],
  )

  const closeOnboarding = useCallback(() => {
    markPendingInvitationsSeen()
    setOnboardingActive(false)
    setOnboardingForced(false)
  }, [markPendingInvitationsSeen, setOnboardingActive, setOnboardingForced])

  // Dev-only console hook: `onboarding()` (re-)enters the flow — works whether
  // or not the account already has teams, and even while the overlay is
  // already open.
  useEffect(() => {
    if (!paneActive || !import.meta.env.DEV) return
    type OnboardingDevHook = (() => void) & {
      confetti: () => void
      firstRun: (on?: boolean) => void
    }
    const hook = (() => {
      setOnboardingForced(true)
      setOnboardingNonce((n) => n + 1)
      setOnboardingActive(true)
    }) as OnboardingDevHook

    // Replay the celebration on demand, without having to actually create or
    // join a workspace.
    hook.confetti = () => setLandingCelebration(true)
    hook.firstRun = (on = true) => setFirstRunDevForced(on)
    ;(window as unknown as { onboarding?: OnboardingDevHook }).onboarding = hook
    console.info(
      '[onboarding] dev controls: onboarding() to enter · onboarding.confetti() to replay the landing celebration · onboarding.firstRun() to show the unbound Agent home despite bound clouds (firstRun(false) to clear)',
    )

    return () => {
      delete (window as unknown as { onboarding?: OnboardingDevHook }).onboarding
    }
  }, [
    paneActive,
    setFirstRunDevForced,
    setLandingCelebration,
    setOnboardingActive,
    setOnboardingForced,
    setOnboardingNonce,
  ])

  return {
    invitationTakeoverOpen,
    takeoverInvitations,
    closeInvitationTakeover,
    continueInvitationTakeover,
    handleTeamRemoved,
    createWorkspaceForOnboarding,
    finishOnboarding,
    closeOnboarding,
  }
}

export type WorkspaceTakeoverResult = ReturnType<typeof useWorkspaceTakeover>
