import { sessionKeyOf } from './workspaceState.ts'

import type { WorkspaceState } from './workspaceState'

/** One browser tab in a conversation's dock, as the iPhone's Dock panel lists it. */
export type DockBrowserTab = { id: string; url: string; title: string }

/**
 * The conversation's browser tabs as its dock holds them: whoever opened them
 * (the agent or the user), restored after a restart or open now. The store
 * hydrates every persisted dock at start, so this is the whole set.
 */
export function dockBrowserTabs(state: WorkspaceState, sessionId: string): DockBrowserTab[] {
  return (state.buckets[sessionKeyOf(sessionId)]?.tabs ?? [])
    .filter((tab) => tab.active === 'team.browser')
    .map((tab) => ({
      id: tab.id,
      url: tab.browserUrl ?? '',
      title: tab.pageMeta?.title ?? tab.restoredTitle ?? '',
    }))
}

/** Every split pane's store; a conversation's dock lives in whichever pane holds it. */
const stores = new Set<() => WorkspaceState>()

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- merges into Window
  interface Window {
    /** Read by the main process (`browser-tabs.ts`) when the iPhone asks for a dock's tabs. */
    nuphosDockBrowserTabs?: (sessionId: string) => DockBrowserTab[]
  }
}

/** Lists a pane's dock tabs to the main process while the pane is mounted. */
export function exposeDockBrowserTabs(getState: () => WorkspaceState): () => void {
  stores.add(getState)
  window.nuphosDockBrowserTabs = (sessionId) => {
    const byId = new Map<string, DockBrowserTab>()

    for (const read of stores)
      for (const tab of dockBrowserTabs(read(), sessionId)) byId.set(tab.id, tab)

    return [...byId.values()]
  }

  return () => {
    stores.delete(getState)
  }
}
