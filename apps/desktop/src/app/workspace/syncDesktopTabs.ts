import { emptyNavigation } from '../../lib/app-routes/parseShared.ts'
import {
  desktopTabId,
  planDesktopTabs,
  readAppearedDesktops,
  readDesktopFocus,
  readSessionDesktops,
} from '../../lib/sessionDesktops.ts'
import { createWorkspaceTabFromNavigation } from '../workspaceTabFactory.ts'

import { selectBucket } from './store/workspaceState.ts'

import type { WorkspaceStore } from './store/workspaceStore.ts'

/**
 * Opens a dock tab for a desktop that just appeared, or one being brought forward,
 * and closes the tabs of desktops a session on screen no longer holds.
 */
export function syncDesktopTabs(store: WorkspaceStore): void {
  const state = store.getState()
  const focus = readDesktopFocus()
  const plan = planDesktopTabs(
    readSessionDesktops(),
    (sessionId) => selectBucket(state, sessionId).tabs,
    [...readAppearedDesktops(), ...(focus ? [focus] : [])],
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
