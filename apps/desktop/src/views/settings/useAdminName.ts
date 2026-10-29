import { adminName } from '../../components/agent/panel/agentSignInModel'
import { useTeamMemberList } from '../../hooks/useTeamMemberList'

/**
 * The administrator a member should ask, by name: the longest-standing one. Derived from the
 * one shared read of the team's members, so a page with several hints asks once. Null until it
 * lands, when it cannot be read, or when `enabled` is false (the viewer is one).
 */
export function useAdminName(teamId: string | undefined, enabled = true): string | null {
  const members = useTeamMemberList(teamId, enabled)

  return enabled && members ? adminName(members) : null
}
