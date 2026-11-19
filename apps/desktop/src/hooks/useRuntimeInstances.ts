import { useEffect, useRef } from 'react'

import { queryClient } from '../lib/query/client.ts'
import { refreshRuntimeLists, useRuntimeInstancesQuery } from '../lib/query/runtime.ts'

import type { RuntimeInstance } from '../types/runtime'

export const RUNTIME_INSTANCES_CHANGED = 'nuphos:runtime-instances-changed'

const NO_INSTANCES: RuntimeInstance[] = []

// One listener for the whole window: a change refreshes each team's shared
// agents and usage once, not once per panel watching them.
if (typeof window !== 'undefined')
  window.addEventListener(RUNTIME_INSTANCES_CHANGED, () => void refreshRuntimeLists(queryClient))

export function useRuntimeInstances(teamId?: string, refreshKey = 0) {
  const query = useRuntimeInstancesQuery(teamId)

  const { refetch } = query
  const firstRefreshKey = useRef(refreshKey)

  useEffect(() => {
    if (teamId && refreshKey !== firstRefreshKey.current) void refetch()
  }, [teamId, refreshKey, refetch])

  return {
    instances: query.data ?? NO_INSTANCES,
    loading: Boolean(teamId) && query.isPending,
    error: query.isError ? 'Could not load runtimes. Try again.' : null,
    refresh: () => {
      if (teamId) void refetch()
    },
  }
}
