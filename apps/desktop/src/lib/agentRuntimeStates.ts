import { useSyncExternalStore } from 'react'

import { acceptRuntimeSnapshot } from './runtimeExecution.ts'

import type { RuntimeExecution } from './runtimeExecution.ts'

// The one place a session's runtime state lives. Every reader (stream frames,
// the open conversation's poll, the session list, thread status) publishes here
// and every view reads from here, so no two copies can disagree.
let snapshot: ReadonlyMap<string, RuntimeExecution> = new Map()
const listeners = new Set<() => void>()
// A runtime process never comes back: once a newer epoch has been seen, a late
// reading from an older one (with its pending requests) must not become current.
const epochs = new Map<string, { latest: string; retired: Set<string> }>()

function fromRetiredEpoch(sessionId: string, state: RuntimeExecution): boolean {
  if (!state.epoch) return false
  const seen = epochs.get(sessionId)

  if (seen?.retired.has(state.epoch)) return true
  if (!seen) epochs.set(sessionId, { latest: state.epoch, retired: new Set() })
  else if (seen.latest !== state.epoch) {
    seen.retired.add(seen.latest)
    seen.latest = state.epoch
  }

  return false
}

export function publishRuntimeStates(states: Iterable<readonly [string, RuntimeExecution]>) {
  const next = new Map(snapshot)
  let changed = false

  for (const [sessionId, state] of states) {
    if (fromRetiredEpoch(sessionId, state)) continue
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

export function subscribeRuntimeStates(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function getRuntimeStates(): ReadonlyMap<string, RuntimeExecution> {
  return snapshot
}

/** For code outside render, such as a `setTabs` updater. */
export function runtimeStateOf(sessionId: string | null | undefined): RuntimeExecution | undefined {
  return sessionId ? snapshot.get(sessionId) : undefined
}

export function useAgentRuntimeStates(): ReadonlyMap<string, RuntimeExecution> {
  return useSyncExternalStore(subscribeRuntimeStates, getRuntimeStates, getRuntimeStates)
}
