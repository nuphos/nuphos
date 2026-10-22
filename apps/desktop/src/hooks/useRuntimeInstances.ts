import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

import { api } from '../api.ts'

import { pollSnapshot, refreshPoll, subscribePoll } from './sharedPoll.ts'

import type { RuntimeInstance } from '../types/runtime'

export const RUNTIME_INSTANCES_CHANGED = 'nuphos:runtime-instances-changed'

const INSTANCES_POLL_MS = 10_000

export const runtimeInstancesKey = (teamId: string) => `runtime-instances:${teamId}`
export const runtimeQuotasKey = (teamId: string) => `runtime-quotas:${teamId}`

// The agents' presence each team's usage was last read for. Presence and the
// first usage reading can arrive after the first usage request, so a change
// here reads usage again.
const presenceRead = new Map<string, string>()

export async function loadInstances(teamId: string): Promise<RuntimeInstance[]> {
  const instances = await api.atlasListRuntimeInstances(teamId)
  const presence = JSON.stringify(instances.map(({ id, local }) => [id, local?.usageAt]))
  const read = presenceRead.get(teamId)

  presenceRead.set(teamId, presence)
  if (read !== undefined && read !== presence) refreshPoll(runtimeQuotasKey(teamId))

  return instances
}

// One listener for the whole window: a change refreshes each team's shared
// agents and usage once, not once per panel watching them.
const watchedTeams = new Set<string>()

if (typeof window !== 'undefined')
  window.addEventListener(RUNTIME_INSTANCES_CHANGED, () => {
    for (const teamId of watchedTeams) {
      refreshPoll(runtimeInstancesKey(teamId))
      refreshPoll(runtimeQuotasKey(teamId))
    }
  })

export function useRuntimeInstances(teamId?: string, refreshKey = 0) {
  const key = teamId ? runtimeInstancesKey(teamId) : undefined
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!teamId || !key) return () => {}
      watchedTeams.add(teamId)

      return subscribePoll(key, () => loadInstances(teamId), INSTANCES_POLL_MS, listener)
    },
    [teamId, key],
  )
  const snapshot = useSyncExternalStore(subscribe, () => pollSnapshot<RuntimeInstance[]>(key))
  const firstRefreshKey = useRef(refreshKey)

  useEffect(() => {
    if (key && refreshKey !== firstRefreshKey.current) refreshPoll(key)
  }, [key, refreshKey])

  return {
    instances: snapshot.value ?? [],
    loading: Boolean(teamId && !snapshot.settled),
    error: snapshot.failed ? 'Could not load runtimes. Try again.' : null,
    refresh: () => {
      if (key) refreshPoll(key)
    },
  }
}
