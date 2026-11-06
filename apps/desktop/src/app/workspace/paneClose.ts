import { paneIdsOf } from './store/windowSurfaceSync.ts'
import {
  MAIN_PAGE_BUCKET_KEY,
  selectAllResidentTabs,
  selectBucket,
} from './store/workspaceState.ts'

import type { SplitLayout } from './splitLayout'
import type { WorkspaceState } from './store/workspaceState'
import type { WorkspaceStore } from './store/workspaceStore'

/**
 * Tabs that end with a closing split pane instead of moving to its heir: the
 * main page stays the pane's own, so its pages (and any pod or node shell they
 * hold) close with it, and an SSH tab still connecting would hand its session
 * to this pane's store after it unmounts. Closing them before unmount lets the
 * teardown observer end their sessions.
 */
export function tabsEndingWithPane(state: WorkspaceState): string[] {
  const mainPage = selectBucket(state, MAIN_PAGE_BUCKET_KEY).tabs
  const connecting = selectAllResidentTabs(state).filter(
    (tab) => tab.sshTerminal?.status === 'connecting' && !mainPage.includes(tab),
  )

  return [...mainPage, ...connecting].map((tab) => tab.id)
}

/**
 * Closing a pane only changes the layout: its chats' docks, terminals included,
 * carry on in its heir, the pane that takes focus.
 * Their shells are keyed by tab id, so they reattach there with their scrollback.
 */
export function handOverPane(store: WorkspaceStore, heir: WorkspaceStore | undefined) {
  // Dispatch before unmount so the teardown observer ends their sessions.
  for (const tabId of tabsEndingWithPane(store.getState())) store.actions.closeTab(tabId)
  heir?.actions.adoptBuckets(store.getState().buckets)
}

/** Closes every pane but `keep`, so a team switch leaves no pane on the old team. */
export function closeOtherPanes(
  layout: SplitLayout,
  keep: string,
  stores: ReadonlyMap<string, WorkspaceStore>,
): string[] {
  const closed = paneIdsOf(layout).filter((id) => id !== keep)

  for (const id of closed) {
    const store = stores.get(id)

    if (store) handOverPane(store, stores.get(keep))
  }

  return closed
}
