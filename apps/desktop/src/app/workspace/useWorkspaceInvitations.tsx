import { useCallback } from 'react'

import { api } from '../../api'

import { selectScope } from './store/workspaceState'

import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceTeamsSyncResult } from './useWorkspaceTeamsSync'
import type { WorkspaceProps } from './workspaceProps'

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult &
  WorkspaceTeamsResult &
  WorkspaceTeamsSyncResult

export function useWorkspaceInvitations(a: Args) {
  const {
    teams,
    setTeams,
    setPendingInvitations,
    setEc2InstancesByAccount,
    setLightsailInstancesByAccount,
    setGceInstancesByProject,
    workspaceStore,
    setError,
    setOnboardingActive,
    setLandingCelebration,
    bootstrapTeams,
    invitationsFetchTokenRef,
    applyPendingInvitations,
  } = a

  // Workspace discovery by email domain: joining a discoverable workspace is
  // still available from the "Create or join" picker; we no longer auto-prompt
  // after login.
  const joinDiscoverableTeam = useCallback(
    async (teamId: string) => {
      await api.atlasJoinDiscoverableTeam(teamId)
      const nextTeams = await api.atlasListTeams()

      if (selectScope(workspaceStore.getState())) {
        setTeams(nextTeams)
      } else {
        bootstrapTeams(nextTeams)
      }
      // Joining a workspace is worth a celebration, same as creating one.
      setLandingCelebration(true)
    },
    [bootstrapTeams, setLandingCelebration, setTeams, workspaceStore],
  )

  // Resolves the joined team's id so the onboarding overlay can keep walking
  // its flow (security briefing → connect) on the accepted team.
  const acceptInvitation = useCallback(
    async (invitationId: string): Promise<string> => {
      const accepted = await api.atlasAcceptInvitation(invitationId)
      const token = ++invitationsFetchTokenRef.current
      const [nextTeams, nextInvitations] = await Promise.all([
        api.atlasListTeams(),
        api.atlasListMyInvitations(),
      ])

      if (selectScope(workspaceStore.getState())) {
        setTeams(nextTeams)
      } else {
        bootstrapTeams(nextTeams)
      }
      if (token === invitationsFetchTokenRef.current) applyPendingInvitations(nextInvitations)
      // Same celebration as creating a workspace — the member's side of it.
      setLandingCelebration(true)

      return accepted.teamId
    },
    [
      applyPendingInvitations,
      bootstrapTeams,
      invitationsFetchTokenRef,
      setLandingCelebration,
      setTeams,
      workspaceStore,
    ],
  )

  const rejectInvitation = useCallback(
    async (invitationId: string) => {
      await api.atlasRejectInvitation(invitationId)
      const token = ++invitationsFetchTokenRef.current
      const nextInvitations = await api.atlasListMyInvitations()
      const pending = nextInvitations.filter(
        (invitation) => !invitation.acceptedAt && !invitation.rejectedAt,
      )

      if (token === invitationsFetchTokenRef.current) setPendingInvitations(pending)
      // Rejecting the last pending invitation while still teamless makes this a
      // brand-new account, so route into onboarding. The mount-time auto-entry
      // effect is one-shot and won't re-fire, so trigger it explicitly here.
      if (pending.length === 0 && teams.length === 0) {
        setError('No teams are available for this account.')
        setOnboardingActive(true)
      }
    },
    [invitationsFetchTokenRef, setError, setOnboardingActive, setPendingInvitations, teams.length],
  )

  const loadEc2InstancesForAccount = useCallback(
    (teamId: string, accountId: string) => {
      const key = `${teamId}/${accountId}`

      setEc2InstancesByAccount((prev) => (prev[key] === undefined ? { ...prev, [key]: [] } : prev))
      api
        .atlasListAwsEc2Instances(teamId, accountId)
        .then((items) => setEc2InstancesByAccount((p) => ({ ...p, [key]: items })))
        .catch(() => {})
    },
    [setEc2InstancesByAccount],
  )
  const loadLightsailInstancesForAccount = useCallback(
    (teamId: string, accountId: string) => {
      const key = `${teamId}/${accountId}`

      setLightsailInstancesByAccount((prev) =>
        prev[key] === undefined ? { ...prev, [key]: [] } : prev,
      )
      api
        .atlasListAwsLightsailInstances(teamId, accountId)
        .then((items) => setLightsailInstancesByAccount((p) => ({ ...p, [key]: items })))
        .catch(() => {})
    },
    [setLightsailInstancesByAccount],
  )
  const loadGceInstancesForProject = useCallback(
    (teamId: string, projectId: string) => {
      const key = `${teamId}/${projectId}`

      setGceInstancesByProject((prev) => (prev[key] === undefined ? { ...prev, [key]: [] } : prev))
      api
        .atlasListGcpComputeInstances(teamId, projectId)
        .then((items) => setGceInstancesByProject((p) => ({ ...p, [key]: items })))
        .catch(() => {})
    },
    [setGceInstancesByProject],
  )

  return {
    joinDiscoverableTeam,
    acceptInvitation,
    rejectInvitation,
    loadEc2InstancesForAccount,
    loadLightsailInstancesForAccount,
    loadGceInstancesForProject,
  }
}

export type WorkspaceInvitationsResult = ReturnType<typeof useWorkspaceInvitations>
