import { useSyncExternalStore } from 'react'

import { readLocalStorage, writeLocalStorage } from '../app/localStorage.ts'

export type AgentAppearance = {
  density: 'compact' | 'comfortable'
}

const KEY = 'nuphos.agentAppearance'
const DEFAULTS: AgentAppearance = { density: 'compact' }

export function parseAgentAppearance(raw: string | null): AgentAppearance {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')

    if (value && typeof value === 'object') {
      return {
        density: 'density' in value && value.density === 'comfortable' ? 'comfortable' : 'compact',
      }
    }
  } catch {
    // Invalid or unavailable storage uses the product defaults.
  }

  return DEFAULTS
}

let appearance = parseAgentAppearance(readLocalStorage(KEY))
const listeners = new Set<() => void>()

function publish(next: AgentAppearance) {
  if (next.density === appearance.density) return
  appearance = next
  for (const listener of listeners) listener()
}

export function setAgentAppearance(patch: Partial<AgentAppearance>) {
  const next = { ...appearance, ...patch }

  writeLocalStorage(KEY, JSON.stringify(next))
  publish(next)
}

function onStorage(event: StorageEvent) {
  if (event.key === KEY || event.key === null) publish(parseAgentAppearance(readLocalStorage(KEY)))
}

function subscribe(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener('storage', onStorage)
    publish(parseAgentAppearance(readLocalStorage(KEY)))
  }
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener('storage', onStorage)
  }
}

export function useAgentAppearance(): AgentAppearance {
  return useSyncExternalStore(
    subscribe,
    () => appearance,
    () => DEFAULTS,
  )
}
