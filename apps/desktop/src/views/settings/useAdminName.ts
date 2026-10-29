import { useEffect, useState } from 'react'

import { api } from '../../api'
import { adminName } from '../../components/agent/panel/agentSignInModel'

/**
 * The administrator a member should ask, by name: the longest-standing one. Null until the
 * team's members load, when they cannot be read, or when `enabled` is false (the viewer is one).
 */
export function useAdminName(teamId: string | undefined, enabled = true): string | null {
  const [found, setFound] = useState<{ teamId: string; name: string | null } | null>(null)

  useEffect(() => {
    if (!teamId || !enabled) return
    let alive = true

    api.atlasListTeamMembers(teamId).then(
      (members) => alive && setFound({ teamId, name: adminName(members) }),
      () => {},
    )

    return () => {
      alive = false
    }
  }, [teamId, enabled])

  return enabled && found && found.teamId === teamId ? found.name : null
}
