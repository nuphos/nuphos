import { useSyncExternalStore } from 'react'

import { acceptRuntimeSnapshot } from './runtimeExecution.ts'

import type { RuntimeExecution } from './runtimeExecution.ts'

// The one place a session's runtime state lives. Every reader (stream frames,
// the open conversation's poll, the session list, thread status) publishes here
// and every view reads from here, so no two copies can disagree.
let snapshot: ReadonlyMap<string, RuntimeExecution> = new Map()
const listeners = new Set<() => void>()

export function publishRuntimeStates(states: Iterable<readonly [string, RuntimeExecution]>) {
  const next = new Map(snapshot)
  let changed = false

  for (const [sessionId, state] of states) {
    const current = next.get(sessionId)
    const selected = acceptRuntimeSnapshot(current, state)

    if (selected === current) continue
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

/** For code outside render, such as a `setTabs` updater. */
export function runtimeStateOf(sessionId: string | null | undefined): RuntimeExecution | undefined {
  return sessionId ? snapshot.get(sessionId) : undefined
}

export function useAgentRuntimeStates(): ReadonlyMap<string, RuntimeExecution> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
