import { useCallback, useEffect } from 'react'

import { api } from '../../../api'
import { toast } from '../../../components/ui/toast'
import { useResetOnKey } from '../../useResetOnKey'
import { afterWorkspace } from '../onboardingSteps'

import type { ChatStep } from './shared'
import type { AtlasTeam, DiscoverableTeam, TeamInvitation } from '../../../types'
import type { Dispatch, SetStateAction } from 'react'

export function useJoinOptionsSync({
  onJoinDiscoverableTeam,
  pendingInvitations,
  setDiscoverableTeams,
  setInvitations,
}: {
  onJoinDiscoverableTeam?: (teamId: string) => Promise<void>
  pendingInvitations?: TeamInvitation[]
  setDiscoverableTeams: Dispatch<SetStateAction<DiscoverableTeam[]>>
  setInvitations: Dispatch<SetStateAction<TeamInvitation[]>>
}) {
  useEffect(() => {
    if (!onJoinDiscoverableTeam) return
    let cancelled = false

    api
      .atlasListDiscoverableTeams()
      .then((teams) => {
        if (cancelled) return
        setDiscoverableTeams(teams)
      })
      // Discovery failing should never block onboarding.
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [onJoinDiscoverableTeam, setDiscoverableTeams])

  // Invitations can arrive while the overlay is already open — e.g. the user
  // clicked an email's accept link, which focused the app, whose focus
  // refresh pulled a fresh pending list. Merge newcomers into the local
  // snapshot (append-only: accepted cards must stay visible as "Joined"); the
  // derived mode below then surfaces the pick screen on its own.
  useResetOnKey((pendingInvitations ?? []).map((item) => item.id).join(','), () => {
    const incoming = pendingInvitations ?? []

    if (incoming.length === 0) return
    setInvitations((prev) => {
      const known = new Set(prev.map((item) => item.id))
      const fresh = incoming.filter((item) => !known.has(item.id))

      return fresh.length === 0 ? prev : [...prev, ...fresh]
    })
  })
}

export function useWorkspaceActions({
  workspaceName,
  setWorkspaceName,
  creating,
  setCreating,
  setChatStep,
  onCreateWorkspace,
  setTeamId,
  onAcceptInvitation,
  onJoinDiscoverableTeam,
  setActingInvitationId,
  invitations,
  discoverableTeams,
  selectedInvitationIds,
  setSelectedInvitationIds,
  selectedTeamIds,
  setSelectedTeamIds,
  committing,
  setCommitting,
  setJoinedTeams,
  setJoiningTeamId,
  joinedTeams,
  setJoinedExisting,
  onCreated,
  onFinish,
}: {
  workspaceName: string
  setWorkspaceName: Dispatch<SetStateAction<string>>
  creating: boolean
  setCreating: Dispatch<SetStateAction<boolean>>
  setChatStep: Dispatch<SetStateAction<ChatStep>>
  onCreateWorkspace: (name: string) => Promise<AtlasTeam>
  setTeamId: Dispatch<SetStateAction<string | null>>
  onAcceptInvitation?: (invitationId: string) => Promise<string>
  onJoinDiscoverableTeam?: (teamId: string) => Promise<void>
  setActingInvitationId: Dispatch<SetStateAction<string | null>>
  invitations: TeamInvitation[]
  discoverableTeams: DiscoverableTeam[]
  selectedInvitationIds: ReadonlySet<string>
  setSelectedInvitationIds: Dispatch<SetStateAction<ReadonlySet<string>>>
  selectedTeamIds: ReadonlySet<string>
  setSelectedTeamIds: Dispatch<SetStateAction<ReadonlySet<string>>>
  committing: boolean
  setCommitting: Dispatch<SetStateAction<boolean>>
  setJoinedTeams: Dispatch<SetStateAction<{ id: string; name: string }[]>>
  setJoiningTeamId: Dispatch<SetStateAction<string | null>>
  joinedTeams: { id: string; name: string }[]
  setJoinedExisting: Dispatch<SetStateAction<boolean>>
  /** A new workspace exists and is ready for its agent setup. */
  onCreated: (team: AtlasTeam) => void
  onFinish: (teamId: string | null) => void
}) {
  const handleCreate = useCallback(async () => {
    const name = workspaceName.trim()

    if (!name || creating) return
    setCreating(true)
    setChatStep('creating')
    try {
      const team = await onCreateWorkspace(name)

      setTeamId(team.id)
      if (afterWorkspace() === 'finish') onCreated(team)
      else setChatStep('security')
    } catch (e) {
      toast.apiError('Could not create workspace', e)
      setChatStep('workspace')
    } finally {
      setCreating(false)
    }
  }, [workspaceName, creating, setCreating, setChatStep, onCreateWorkspace, setTeamId, onCreated])

  // Picking a card is a pure selection — nothing is joined until Continue
  // commits the whole set, so changing one's mind before that costs nothing.
  const toggleInvitationSelected = useCallback(
    (invitation: TeamInvitation) => {
      if (committing) return
      setSelectedInvitationIds((prev) => {
        const next = new Set(prev)

        if (!next.delete(invitation.id)) next.add(invitation.id)

        return next
      })
    },
    [committing, setSelectedInvitationIds],
  )

  const toggleTeamSelected = useCallback(
    (team: DiscoverableTeam) => {
      if (committing) return
      setSelectedTeamIds((prev) => {
        const next = new Set(prev)

        if (!next.delete(team.id)) next.add(team.id)

        return next
      })
    },
    [committing, setSelectedTeamIds],
  )

  // Continue commits the selection: accept the picked invitations and join the
  // picked discoverable teams one by one (each card shows its own spinner and
  // flips to "Joined" as it lands). A failed join keeps its card selected for
  // a retry and holds the flow on the pick screen; only a fully clean pass
  // advances, carrying the first joined team as the context for the remaining
  // steps (security briefing, the cloud demo, and the real Slack bind).
  const handleContinueSelected = useCallback(async () => {
    if (committing || creating) return
    const selectedInvitations = invitations.filter((item) => selectedInvitationIds.has(item.id))
    const selectedDiscoverable = discoverableTeams.filter((team) => selectedTeamIds.has(team.id))
    const joined = [...joinedTeams]

    if (selectedInvitations.length + selectedDiscoverable.length === 0 && joined.length === 0) {
      return
    }

    const recordJoined = (id: string, name: string) => {
      if (!joined.some((team) => team.id === id)) joined.push({ id, name })
      setJoinedTeams([...joined])
    }
    const unselectInvitation = (id: string) =>
      setSelectedInvitationIds((prev) => {
        const next = new Set(prev)

        next.delete(id)

        return next
      })
    const unselectTeam = (id: string) =>
      setSelectedTeamIds((prev) => {
        const next = new Set(prev)

        next.delete(id)

        return next
      })

    setCommitting(true)
    let failures = 0

    for (const invitation of selectedInvitations) {
      if (!onAcceptInvitation) break
      // The same team can be picked twice (an invitation plus a discoverable
      // card): the first join wins and the duplicate is just unmarked.
      if (joined.some((team) => team.id === invitation.teamId)) {
        unselectInvitation(invitation.id)
        continue
      }
      setActingInvitationId(invitation.id)
      try {
        const joinedTeamId = await onAcceptInvitation(invitation.id)

        recordJoined(joinedTeamId, invitation.team?.name ?? 'Your workspace')
        unselectInvitation(invitation.id)
      } catch (e) {
        failures += 1
        toast.apiError('Could not accept invitation', e)
      } finally {
        setActingInvitationId(null)
      }
    }
    for (const team of selectedDiscoverable) {
      if (!onJoinDiscoverableTeam) break
      if (joined.some((item) => item.id === team.id)) {
        unselectTeam(team.id)
        continue
      }
      setJoiningTeamId(team.id)
      try {
        await onJoinDiscoverableTeam(team.id)
        recordJoined(team.id, team.name)
        unselectTeam(team.id)
      } catch (e) {
        failures += 1
        toast.apiError(`Could not join ${team.name}`, e)
      } finally {
        setJoiningTeamId(null)
      }
    }
    setCommitting(false)

    if (failures > 0 || joined.length === 0) return
    const primary = joined[0]

    setTeamId(primary.id)
    setWorkspaceName(
      joined.length > 1 ? `${primary.name} +${String(joined.length - 1)} more` : primary.name,
    )
    setJoinedExisting(true)
    if (afterWorkspace() === 'finish') onFinish(primary.id)
    else setChatStep('security')
  }, [
    committing,
    creating,
    invitations,
    discoverableTeams,
    selectedInvitationIds,
    selectedTeamIds,
    joinedTeams,
    onAcceptInvitation,
    onJoinDiscoverableTeam,
    setActingInvitationId,
    setJoiningTeamId,
    setJoinedTeams,
    setSelectedInvitationIds,
    setSelectedTeamIds,
    setCommitting,
    setTeamId,
    setWorkspaceName,
    setJoinedExisting,
    setChatStep,
  ])

  return {
    handleCreate,
    toggleInvitationSelected,
    toggleTeamSelected,
    handleContinueSelected,
  }
}
