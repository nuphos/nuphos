import type { WorkspaceTabState } from '../../workspaceTabState'
import type { TabDropPlacement } from '../tabs/tabsTypes'

export type TabHistoryMode = 'record' | 'replace' | 'restore'

export type TabUpdater = (tab: WorkspaceTabState) => WorkspaceTabState

export type OpenTabOptions = {
  /** Insert right after this tab instead of at the end of the strip. */
  afterTabId?: string
  /** A lone, untouched team tab that is also active gets replaced, not joined. */
  replaceLoneFreshTab?: boolean
  openDock?: boolean
}

/**
 * Every action that reads or writes a dock names its session (`sessionKey`) or
 * a tab (`tabId`, globally unique, so its owning session is found by lookup).
 * Nothing resolves "the current session" from a value captured at render time.
 */
export type WorkspaceAction =
  | {
      type: 'selectSession'
      sessionId: string | null
      readOnly: boolean
      teamId?: string
      keepMainPage?: boolean
      resetHomeScroll?: boolean
    }
  | { type: 'openMainPage'; teamId: string }
  | { type: 'setSessionReadOnly'; readOnly: boolean }
  | { type: 'switchTeam'; sessionKey: string; teamId: string }
  | { type: 'setDockOpen'; sessionKey: string; open: boolean }
  | { type: 'setTabs'; sessionKey: string; tabs: WorkspaceTabState[] }
  | { type: 'openTab'; sessionKey: string; tab: WorkspaceTabState; options?: OpenTabOptions }
  | { type: 'activateTab'; sessionKey: string; tabId: string }
  | { type: 'openTeamTab'; sessionKey: string; teamId: string }
  | { type: 'selectAdjacentTab'; sessionKey: string; direction: -1 | 1 }
  | { type: 'selectTabAt'; sessionKey: string; position: number | 'last' }
  | { type: 'mapTabs'; sessionKey: string; updater: TabUpdater }
  | { type: 'closeTab'; tabId: string }
  | { type: 'closeOtherTabs'; tabId: string }
  | { type: 'reorderTab'; tabId: string; targetTabId: string; placement: TabDropPlacement }
  | { type: 'updateTab'; tabId: string; updater: TabUpdater; history?: TabHistoryMode }
  | { type: 'retainTeams'; teamIds: readonly string[]; preferredTeamId: string | null }
  | { type: 'removeTeam'; teamId: string }

export type WorkspaceStoreDeps = {
  createTab: (teamId: string) => WorkspaceTabState
}
