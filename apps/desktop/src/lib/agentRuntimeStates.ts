import { useSyncExternalStore } from 'react'

import { newestRuntimeSnapshot } from './runtimeExecution.ts'

import type { RuntimeExecution } from './runtimeExecution.ts'

// Keep the latest runtime observation, including idle/unknown, across panel
// unmounts. A boolean union loses stop events and lets older list data win.
let snapshot: ReadonlyMap<string, RuntimeExecution> = new Map()
const listeners = new Set<() => void>()

export function publishRuntimeStates(states: Iterable<readonly [string, RuntimeExecution]>) {
  const next = new Map(snapshot)
  let changed = false

  for (const [sessionId, state] of states) {
    const current = next.get(sessionId)
    const selected = newestRuntimeSnapshot(current, state)

    if (!selected || selected === current) continue
    next.set(sessionId, selected)
    changed = true
  }
  if (!changed) return
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return snapshot
}

export function useAgentRuntimeStates(): ReadonlyMap<string, RuntimeExecution> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
