import { browserViewId, setWatchedDockTab } from '../watchedDockTabs.ts'

import { sessionKeyOf } from './workspaceState.ts'

import type { WorkspaceState } from './workspaceState'
import type { WorkspaceActions } from './workspaceStore'

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

/** How long a watched tab may take to mount and attach its page. */
const ATTACH_TIMEOUT_MS = 15_000

type PaneStore = { getState: () => WorkspaceState; actions: Pick<WorkspaceActions, 'mountTab'> }

/** Every split pane's store; a conversation's dock lives in whichever pane holds it. */
const stores = new Set<PaneStore>()

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- merges into Window
  interface Window {
    /** Read by the main process (`browser-tabs.ts`) when the iPhone asks for a dock's tabs. */
    nuphosDockBrowserTabs?: (sessionId: string) => DockBrowserTab[]
    /**
     * A phone starts watching a dock tab (`browser-view.ts`): its page is mounted and kept
     * painting at `width`x`height`. Resolves the page's webContents id, or null.
     */
    nuphosWatchDockTab?: (
      sessionId: string,
      tabId: string,
      width: number,
      height: number,
    ) => Promise<number | null>
    nuphosUnwatchDockTab?: (tabId: string) => void
  }
}

function listDockTabs(sessionId: string): DockBrowserTab[] {
  const byId = new Map<string, DockBrowserTab>()

  for (const store of stores)
    for (const tab of dockBrowserTabs(store.getState(), sessionId)) byId.set(tab.id, tab)

  return [...byId.values()]
}

async function watchDockTab(sessionId: string, tabId: string, width: number, height: number) {
  const store = [...stores].find((candidate) =>
    dockBrowserTabs(candidate.getState(), sessionId).some((tab) => tab.id === tabId),
  )

  if (!store) return null
  store.actions.mountTab(sessionId, tabId)
  setWatchedDockTab(tabId, { width, height })

  return browserViewId(tabId, ATTACH_TIMEOUT_MS)
}

/** Lists a pane's dock tabs to the main process, and lets it watch them, while the pane is mounted. */
export function exposeDockBrowserTabs(store: PaneStore): () => void {
  stores.add(store)
  window.nuphosDockBrowserTabs = listDockTabs
  window.nuphosWatchDockTab = watchDockTab
  window.nuphosUnwatchDockTab = (tabId) => setWatchedDockTab(tabId, null)

  return () => {
    stores.delete(store)
  }
}
