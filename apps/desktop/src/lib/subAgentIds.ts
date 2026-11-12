import { useSyncExternalStore } from 'react'

// Which conversations are sub-tasks (they have a parent), learned from every
// conversation the client fetches. A surface that only knows a chat's ID, such
// as its titlebar menu, reads it here.
let subAgents = new Set<string>()
const listeners = new Set<() => void>()

export function receiveSubAgents(conversations: { sessionId: string; parentSessionId?: string }[]) {
  let next: Set<string> | null = null

  for (const { sessionId, parentSessionId } of conversations) {
    if (Boolean(parentSessionId) === subAgents.has(sessionId)) continue
    next ??= new Set(subAgents)
    if (parentSessionId) next.add(sessionId)
    else next.delete(sessionId)
  }
  if (!next) return
  subAgents = next
  for (const listener of listeners) listener()
}

export function isSubAgent(sessionId: string): boolean {
  return subAgents.has(sessionId)
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export function useIsSubAgent(sessionId: string): boolean {
  return useSyncExternalStore(subscribe, () => isSubAgent(sessionId))
}
