import { useSyncExternalStore } from 'react'

// A Task listed twice, under its Bot and in Tasks, lights up where it was opened from.
const fromBots = new Set<string>()
let snapshot: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

export function setOpenedFromBots(sessionId: string, value: boolean) {
  if (fromBots.has(sessionId) === value) return
  if (value) fromBots.add(sessionId)
  else fromBots.delete(sessionId)
  snapshot = new Set(fromBots)
  listeners.forEach((listener) => listener())
}

export function useOpenedFromBots(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    () => snapshot,
  )
}
