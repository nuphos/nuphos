import { useEffect, useState } from 'react'

import { api } from '../../api'

/**
 * The newer CLI a Box's host can update to: '' when its version is unknown, undefined when
 * there is none. Every agent on a Box reports its host's update, signed in or not, so any asks.
 */
export function useBoxHostUpdate(teamId: string, runtimeId: string | undefined) {
  const [found, setFound] = useState<{ runtimeId: string; version: string }>()

  useEffect(() => {
    if (!runtimeId) return
    let cancelled = false

    api.atlasGetRuntimeInstanceStatus(teamId, runtimeId).then(
      ({ runtimeUpdate }) => {
        if (cancelled) return
        if (runtimeUpdate?.state === 'available' || runtimeUpdate?.state === 'failed')
          setFound({ runtimeId, version: runtimeUpdate.latestVersion ?? '' })
      },
      () => null,
    )

    return () => {
      cancelled = true
    }
  }, [teamId, runtimeId])

  return runtimeId && found?.runtimeId === runtimeId ? found.version : undefined
}
