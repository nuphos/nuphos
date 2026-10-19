import { emptyNavigation } from '../../lib/app-routes/parseShared.ts'
import {
  desktopTabId,
  planDesktopTabs,
  readDesktopFocus,
  readSessionDesktops,
} from '../../lib/sessionDesktops.ts'
import { createWorkspaceTabFromNavigation } from '../workspaceTabFactory.ts'

import { selectBucket } from './store/workspaceState.ts'

import type { WorkspaceStore } from './store/workspaceStore.ts'

/**
 * Opens the dock tab of a desktop the user brings forward, and closes the tabs
 * of desktops a session on screen no longer holds.
 */
export function syncDesktopTabs(store: WorkspaceStore): void {
  const state = store.getState()
  const focus = readDesktopFocus()
  const plan = planDesktopTabs(
    readSessionDesktops(),
    (sessionId) => selectBucket(state, sessionId).tabs,
    focus,
  )

  for (const tabId of plan.close) store.actions.closeTab(tabId)
  for (const { sessionId, teamId, display } of plan.open) {
    const navigation = emptyNavigation({ kind: 'team', teamId }, 'team.desktop', {
      filter: String(display),
    })

    store.dispatch({
      type: 'openTab',
      sessionKey: sessionId,
      tab: {
        ...createWorkspaceTabFromNavigation(navigation),
        id: desktopTabId(sessionId, display),
      },
      options: { openDock: true },
    })
  }
  if (focus)
    store.dispatch({
      type: 'activateTab',
      sessionKey: focus.sessionId,
      tabId: desktopTabId(focus.sessionId, focus.display),
    })
}
