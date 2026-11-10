import { useSyncExternalStore } from 'react'

// A chat elsewhere (a Bot chat whose agent could not reply) asks this
// conversation's composer to open its agent list; it stays open until closed.
let pending: string | undefined
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

export function requestAgentMenu(sessionId: string): void {
  pending = sessionId
  notify()
}

export function clearAgentMenuRequest(): void {
  if (pending === undefined) return
  pending = undefined
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/** Whether this conversation's agent list was asked for. */
export function useAgentMenuRequested(sessionId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => sessionId !== undefined && pending === sessionId)
}
