import {
  MAIN_PAGE_BUCKET_KEY,
  selectAllResidentTabs,
  selectBucket,
} from './store/workspaceState.ts'

import type { WorkspaceState } from './store/workspaceState'

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
