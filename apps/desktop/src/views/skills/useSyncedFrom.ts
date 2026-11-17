import { useEffect, useState } from 'react'

import { api } from '../../api'

import type { SkillScope } from '../../api'

/**
 * The folder on this computer a personal skill is synced from by Sync my setup,
 * or null: a team skill, or one this computer does not sync.
 */
export function useSyncedFrom(teamId: string, scope: SkillScope, name: string): string | null {
  const [sources, setSources] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    if (scope !== 'personal') return
    let cancelled = false

    void api.localSetupSources(teamId).then(
      (found) => {
        if (!cancelled) setSources(found)
      },
      () => null,
    )

    return () => {
      cancelled = true
    }
  }, [teamId, scope, name])

  return scope === 'personal' ? (sources?.[name] ?? null) : null
}
