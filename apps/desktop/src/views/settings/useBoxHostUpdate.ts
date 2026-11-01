import { useEffect, useState } from 'react'

import { api } from '../../api'

import { hostUpdateVersion } from './runtimeUpdatePresentation'

/**
 * The newer CLI a Box's host can update to: '' when its version is unknown, undefined when
 * there is none. Every agent on a Box reports its host's update, signed in or not, so any asks.
 */
export function useBoxHostUpdate(teamId: string, runtimeId: string | undefined) {
  const [found, setFound] = useState<{ runtimeId: string; version: string | undefined }>()

  useEffect(() => {
    if (!runtimeId) return
    let cancelled = false

    api.atlasGetRuntimeInstanceStatus(teamId, runtimeId).then(
      // Each read replaces the last: the host reads again when it is back from an update, and
      // an answer that it is current takes the badge away.
      ({ runtimeUpdate }) => {
        if (!cancelled) setFound({ runtimeId, version: hostUpdateVersion(runtimeUpdate) })
      },
      () => null,
    )

    return () => {
      cancelled = true
    }
  }, [teamId, runtimeId])

  return runtimeId && found?.runtimeId === runtimeId ? found.version : undefined
}
