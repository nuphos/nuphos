// In-memory stale-while-revalidate cache for view data (list rows, overview
// snapshots), shared by useWatchedList / usePolledList / ClusterOverview.
// A remounting view renders the previous data instantly while the fresh
// LIST / watch / poll runs in the background — this is what makes page
// switches feel instant instead of re-fetching the world on every visit.
//
// Keys MUST uniquely identify the data source, including the kubeconfig
// context and namespace scope — a key that omits the context would leak one
// cluster's rows into another's first paint.
//
// Renderer-process lifetime only: restarting the app starts cold. Bounded
// LRU so a long session hopping across many clusters/namespaces doesn't
// accumulate unbounded row arrays.

import { useCallback, useSyncExternalStore } from 'react'

const MAX_ENTRIES = 64

const cache = new Map<string, unknown>()
const listeners = new Map<string, Set<() => void>>()

export function readSwrCache<T>(key: string): T | undefined {
  const hit = cache.get(key)

  if (hit === undefined) return undefined
  // Re-insert to refresh the entry's LRU position.
  cache.delete(key)
  cache.set(key, hit)

  return hit as T
}

export function writeSwrCache(key: string, value: unknown): void {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value

    if (oldest !== undefined) cache.delete(oldest)
  }
  for (const listener of listeners.get(key) ?? []) listener()
}

/** The cached value for `key`, re-rendering only when someone writes it. */
export function useSwrCache<T>(key: string): T | undefined {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set()

      set.add(listener)
      listeners.set(key, set)

      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(key)
      }
    },
    [key],
  )

  return useSyncExternalStore(subscribe, () => cache.get(key) as T | undefined)
}
