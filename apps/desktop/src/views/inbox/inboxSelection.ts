import { useSyncExternalStore } from 'react'

// The question the Inbox opens, by team. Always the one on screen, so nothing listed later moves it.
const selections = new Map<string, string>()
// The Inbox page's search, by team, while the page is on screen.
const searches = new Map<string, string>()
// The teams whose "Dismiss all" is asking first.
const asking = new Set<string>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function changed() {
  for (const listener of listeners) listener()
}

/** Opens a question in the Inbox: picked in the sidebar's list, or moved to with ↑ ↓, Snooze or Dismiss. */
export function selectInboxQuestion(teamId: string, id: string) {
  if (selections.get(teamId) === id) return
  selections.set(teamId, id)
  changed()
}

/** The question the sidebar's list and the Inbox page both show as open. */
export function useInboxSelection(teamId: string): string | null {
  return useSyncExternalStore(subscribe, () => selections.get(teamId) ?? null)
}

/** The Inbox page's search, '' without one or while the page is not on screen. */
export const inboxSearch = (teamId: string): string => searches.get(teamId) ?? ''

/** The Inbox page shares its search, so the sidebar's list shows the rows the page does. */
export function shareInboxSearch(teamId: string, query: string) {
  if (inboxSearch(teamId) === query) return
  if (query) searches.set(teamId, query)
  else searches.delete(teamId)
  changed()
}

export function useInboxSearch(teamId: string): string {
  return useSyncExternalStore(subscribe, () => inboxSearch(teamId))
}

/** While "Dismiss all" asks first, the Inbox's keys rest, so a digit cannot answer the question behind. */
export function setDismissAllAsking(teamId: string, on: boolean) {
  if (asking.has(teamId) === on) return
  if (on) asking.add(teamId)
  else asking.delete(teamId)
  changed()
}

export function useDismissAllAsking(teamId: string): boolean {
  return useSyncExternalStore(subscribe, () => asking.has(teamId))
}
