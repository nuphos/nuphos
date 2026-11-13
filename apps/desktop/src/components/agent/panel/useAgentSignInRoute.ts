import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useRuntimeInstances } from '../../../hooks/useRuntimeInstances'
import { useTeamMemberList } from '../../../hooks/useTeamMemberList'
import { useThisComputer } from '../../../hooks/useThisComputer'
import { agentTier } from '../../../lib/agentName'

import { signInRoute } from './agentSignInModel'

import type { SignInRoute } from './agentSignInModel'

/**
 * How this viewer signs an agent's runtime in: its CLI on this computer, the
 * runtime's sign-in dialog, asking whoever can, or no way from here. A Task's
 * sign-in card and a Bot chat's "couldn't reply" line work it out alike.
 */
export function useAgentSignInRoute({
  teamId,
  runtimeId,
  isTeamAdmin,
}: {
  teamId: string | undefined
  runtimeId: string | undefined
  isTeamAdmin: boolean
}): { route: SignInRoute; personalAgent: boolean; onThisComputer: boolean } {
  const owner = useThisComputer()
  const viewerId = useCurrentUser()?.id
  const { instances } = useRuntimeInstances(teamId)
  const personalAgent = runtimeId?.startsWith('local_') === true
  const onThisComputer = Boolean(
    runtimeId && personalAgent && agentTier({ id: runtimeId, label: '' }, owner) === 'local',
  )
  const routeOf = (members: Parameters<typeof signInRoute>[0]['members']) =>
    signInRoute({
      runtimeId,
      viewerId,
      isTeamAdmin,
      onThisComputer,
      instance: instances.find((instance) => instance.id === runtimeId),
      members,
    })
  // Who to ask never depends on the members; only their names do.
  const asksSomeone = routeOf(null).kind === 'ask'
  const route = routeOf(useTeamMemberList(teamId, asksSomeone))

  return { route, personalAgent, onThisComputer }
}
