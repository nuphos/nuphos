import { useSyncExternalStore } from 'react'

/** The question the Inbox opens, by team: its id, and where it was listed. */
export type InboxSelection = { id: string; index: number }

const selections = new Map<string, InboxSelection>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Opens a question in the Inbox: picked in the sidebar's list, or moved to with ↑ ↓ or Skip. */
export function selectInboxQuestion(teamId: string, selection: InboxSelection) {
  selections.set(teamId, selection)
  for (const listener of listeners) listener()
}

/** The question the sidebar's list and the Inbox page both show as open. */
export function useInboxSelection(teamId: string): InboxSelection | null {
  return useSyncExternalStore(subscribe, () => selections.get(teamId) ?? null)
}
