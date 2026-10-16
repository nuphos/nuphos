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

/** Opens a dock tab for every desktop a session on screen holds and closes the ones it no longer does. */
export function syncDesktopTabs(store: WorkspaceStore): void {
  const state = store.getState()
  const plan = planDesktopTabs(
    readSessionDesktops(),
    (sessionId) => selectBucket(state, sessionId).tabs,
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
  const focus = readDesktopFocus()

  if (focus)
    store.dispatch({
      type: 'activateTab',
      sessionKey: focus.sessionId,
      tabId: desktopTabId(focus.sessionId, focus.display),
    })
}
