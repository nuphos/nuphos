import { useEffect, useState } from 'react'

import { api } from '../api'

import type { RuntimeInstance } from '../types/runtime'

export const RUNTIME_INSTANCES_CHANGED = 'nuphos:runtime-instances-changed'

export function useRuntimeInstances(teamId?: string) {
  const [state, setState] = useState<{
    teamId?: string
    instances: RuntimeInstance[]
    error: string | null
  }>({ instances: [], error: null })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!teamId) return
    let cancelled = false
    let request = 0
    const load = async () => {
      const current = ++request

      try {
        const instances = await api.atlasListRuntimeInstances(teamId)

        if (!cancelled && current === request) setState({ teamId, instances, error: null })
      } catch {
        if (!cancelled && current === request)
          setState((previous) => ({
            teamId,
            instances: previous.teamId === teamId ? previous.instances : [],
            error: 'Could not load agents. Try again.',
          }))
      }
    }
    const refresh = () => {
      void load()
    }

    refresh()
    const timer = setInterval(refresh, 10_000)

    window.addEventListener(RUNTIME_INSTANCES_CHANGED, refresh)

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener(RUNTIME_INSTANCES_CHANGED, refresh)
    }
  }, [teamId, revision])

  return {
    instances: state.teamId === teamId ? state.instances : [],
    loading: Boolean(teamId && state.teamId !== teamId),
    error: state.teamId === teamId ? state.error : null,
    refresh: () => setRevision((value) => value + 1),
  }
}
