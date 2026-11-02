import { createWorkspaceTab } from '../../workspaceTabFactory.ts'

import { workspaceReducer } from './workspaceReducer.ts'
import {
  createWorkspaceState,
  currentSessionKey,
  selectCurrentBucket,
  sessionKeyOf,
} from './workspaceState.ts'

import type {
  OpenTabOptions,
  TabHistoryMode,
  TabUpdater,
  WorkspaceAction,
  WorkspaceStoreDeps,
} from './workspaceActions'
import type { TabBucket, WorkspaceState } from './workspaceState'
import type { WorkspaceTabState } from '../../workspaceTabState'
import type { TabDropPlacement } from '../tabs/tabsTypes'

type CurrentSessionAction = WorkspaceAction extends infer A
  ? A extends { sessionKey: string }
    ? Omit<A, 'sessionKey'>
    : never
  : never

/**
 * Commands bound once per store, so their identity never changes: listing one
 * in a dependency array is correct forever. The "current session" variants
 * resolve the session when they run, from the store, never from a render.
 * A new tab always belongs to a chat's dock, so opening one leaves the main page.
 */
export type WorkspaceActions = {
  selectSession: (
    sessionId: string | null,
    options?: { readOnly?: boolean; teamId?: string; keepMainPage?: boolean },
  ) => void
  /** Opens the main page, landing on `updater`'s page in the same step so it is one history entry. */
  openMainPage: (teamId: string, updater?: TabUpdater) => void
  stepSurface: (direction: -1 | 1) => void
  goToSurface: (index: number) => void
  forgetSession: (sessionId: string) => void
  setSessionReadOnly: (readOnly: boolean) => void
  switchTeam: (teamId: string) => void
  setDockOpen: (open: boolean) => void
  toggleDock: () => void
  openTab: (tab: WorkspaceTabState, options?: OpenTabOptions) => void
  /** Opens a tab in a conversation's own dock without bringing it on screen. */
  openTabInSession: (sessionId: string, tab: WorkspaceTabState) => void
  activateTab: (tabId: string) => void
  /** Mounts a conversation's tab without showing it, as a phone watching it needs its page. */
  mountTab: (sessionId: string, tabId: string) => void
  openTeamTab: (teamId: string) => void
  selectAdjacentTab: (direction: -1 | 1) => void
  selectTabAt: (position: number | 'last') => void
  mapTabs: (updater: TabUpdater) => void
  closeTab: (tabId: string) => void
  closeOtherTabs: (tabId: string) => void
  reorderTab: (tabId: string, targetTabId: string, placement: TabDropPlacement) => void
  updateTab: (tabId: string, updater: TabUpdater, options?: { history?: TabHistoryMode }) => void
  updateActiveTab: (updater: TabUpdater, options?: { history?: TabHistoryMode }) => void
  retainTeams: (teamIds: readonly string[], preferredTeamId: string | null) => void
  removeTeam: (teamId: string) => void
  /** Takes over the docks of a split pane that is closing; see `adoptBuckets`. */
  adoptBuckets: (buckets: Readonly<Record<string, TabBucket>>) => void
}

export type WorkspaceStore = {
  getState: () => WorkspaceState
  subscribe: (listener: () => void) => () => void
  dispatch: (action: WorkspaceAction) => void
  actions: WorkspaceActions
}

const defaultDeps: WorkspaceStoreDeps = { createTab: createWorkspaceTab }

export function createWorkspaceStore(
  initial: WorkspaceState = createWorkspaceState(),
  deps: WorkspaceStoreDeps = defaultDeps,
): WorkspaceStore {
  let state = initial
  const listeners = new Set<() => void>()

  const getState = () => state
  const subscribe = (listener: () => void) => {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  }
  const dispatch = (action: WorkspaceAction) => {
    const next = workspaceReducer(state, action, deps)

    if (next === state) return
    state = next
    for (const listener of listeners) listener()
  }
  const inCurrentSession = (action: CurrentSessionAction) =>
    dispatch({ ...action, sessionKey: currentSessionKey(state) })
  const showChat = () =>
    dispatch({ type: 'selectSession', sessionId: state.sessionId, readOnly: state.sessionReadOnly })

  const actions: WorkspaceActions = {
    selectSession: (sessionId, options) =>
      dispatch({
        type: 'selectSession',
        sessionId,
        readOnly: options?.readOnly ?? false,
        teamId: options?.teamId,
        keepMainPage: options?.keepMainPage,
        resetHomeScroll: sessionId === null && !options?.keepMainPage,
      }),
    openMainPage: (teamId, updater) => dispatch({ type: 'openMainPage', teamId, updater }),
    stepSurface: (direction) => dispatch({ type: 'stepSurface', direction }),
    goToSurface: (index) => dispatch({ type: 'goToSurface', index }),
    forgetSession: (sessionId) => dispatch({ type: 'forgetSession', sessionId }),
    setSessionReadOnly: (readOnly) => dispatch({ type: 'setSessionReadOnly', readOnly }),
    // The open session belongs to the team being left, so its dock is not
    // rewritten with the new team's tab: switching lands on a new chat instead.
    switchTeam: (teamId) => {
      dispatch({ type: 'selectSession', sessionId: null, readOnly: false })
      inCurrentSession({ type: 'switchTeam', teamId })
    },
    setDockOpen: (open) => inCurrentSession({ type: 'setDockOpen', open }),
    toggleDock: () =>
      inCurrentSession({ type: 'setDockOpen', open: !selectCurrentBucket(state).dockOpen }),
    openTab: (tab, options) => {
      const fromMainPage = state.mainPageOpen

      showChat()
      inCurrentSession({
        type: 'openTab',
        tab,
        options: fromMainPage ? { ...options, openDock: true } : options,
      })
    },
    openTabInSession: (sessionId, tab) =>
      dispatch({
        type: 'openTab',
        sessionKey: sessionKeyOf(sessionId),
        tab,
        options: { openDock: true },
      }),
    activateTab: (tabId) => inCurrentSession({ type: 'activateTab', tabId }),
    mountTab: (sessionId, tabId) =>
      dispatch({ type: 'mountTab', sessionKey: sessionKeyOf(sessionId), tabId }),
    openTeamTab: (teamId) => inCurrentSession({ type: 'openTeamTab', teamId }),
    selectAdjacentTab: (direction) => inCurrentSession({ type: 'selectAdjacentTab', direction }),
    selectTabAt: (position) => inCurrentSession({ type: 'selectTabAt', position }),
    mapTabs: (updater) => inCurrentSession({ type: 'mapTabs', updater }),
    closeTab: (tabId) => dispatch({ type: 'closeTab', tabId }),
    closeOtherTabs: (tabId) => dispatch({ type: 'closeOtherTabs', tabId }),
    reorderTab: (tabId, targetTabId, placement) =>
      dispatch({ type: 'reorderTab', tabId, targetTabId, placement }),
    updateTab: (tabId, updater, options) =>
      dispatch({ type: 'updateTab', tabId, updater, history: options?.history }),
    updateActiveTab: (updater, options) => {
      const tabId = selectCurrentBucket(state).activeTabId

      if (tabId) dispatch({ type: 'updateTab', tabId, updater, history: options?.history })
    },
    retainTeams: (teamIds, preferredTeamId) =>
      dispatch({ type: 'retainTeams', teamIds, preferredTeamId }),
    removeTeam: (teamId) => dispatch({ type: 'removeTeam', teamId }),
    adoptBuckets: (buckets) => dispatch({ type: 'adoptBuckets', buckets }),
  }

  return { getState, subscribe, dispatch, actions }
}
