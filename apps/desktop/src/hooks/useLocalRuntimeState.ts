import { useSyncExternalStore } from 'react'

import { api } from '../api'

import { RUNTIME_INSTANCES_CHANGED } from './useRuntimeInstances'

import type { LocalRuntimeState } from '../api'

let current: LocalRuntimeState | null = null
let started = false
const listeners = new Set<() => void>()

function onlineKey(state: LocalRuntimeState | null): string {
  return state
    ? Object.entries(state.agents)
        .map(
          ([provider, agent]) =>
            `${provider}:${String(agent.online)}:${agent.cli?.installed ? String(agent.cli.loggedIn) : 'missing'}`,
        )
        .join(',')
    : ''
}

function update(next: LocalRuntimeState): void {
  const cameOnline = onlineKey(next) !== onlineKey(current)

  current = next
  for (const listener of listeners) listener()
  // Presence lands on the backend a moment after the tunnel reports it.
  if (cameOnline)
    for (const delay of [0, 1_000])
      setTimeout(() => window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED)), delay)
}

function subscribe(listener: () => void): () => void {
  if (!started) {
    started = true
    void api.localRuntimeGetState().then(update, () => {})
    api.onLocalRuntimeState(update)
  }
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/** This computer's local agents as the desktop itself knows them, pushed on every change. */
export function useLocalRuntimeState(): LocalRuntimeState | null {
  return useSyncExternalStore(subscribe, () => current)
}
