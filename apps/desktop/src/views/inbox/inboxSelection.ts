import { useSyncExternalStore } from 'react'

// The question the Inbox opens, by team. Always the one on screen, so nothing listed later moves it.
const selections = new Map<string, string>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Opens a question in the Inbox: picked in the sidebar's list, or moved to with ↑ ↓, Snooze or Dismiss. */
export function selectInboxQuestion(teamId: string, id: string) {
  if (selections.get(teamId) === id) return
  selections.set(teamId, id)
  for (const listener of listeners) listener()
}

/** The question the sidebar's list and the Inbox page both show as open. */
export function useInboxSelection(teamId: string): string | null {
  return useSyncExternalStore(subscribe, () => selections.get(teamId) ?? null)
}
