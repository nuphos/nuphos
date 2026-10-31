import { useEffect, useState } from 'react'

import { api } from '../api'

import { teamMembersRequest } from './teamMembersRequest'

import type { TeamMember } from '../types/team'

/** `teamId`'s members from the shared read; null until it lands, and never another team's. */
export function useTeamMemberList(teamId: string | undefined, enabled = true): TeamMember[] | null {
  const [loaded, setLoaded] = useState<{ teamId: string; members: TeamMember[] | null } | null>(
    null,
  )

  useEffect(() => {
    if (!teamId || !enabled) return
    let alive = true

    void teamMembersRequest(teamId, api.atlasListTeamMembers).then(
      (members) => alive && setLoaded({ teamId, members }),
    )

    return () => {
      alive = false
    }
  }, [teamId, enabled])

  return loaded && loaded.teamId === teamId ? loaded.members : null
}
