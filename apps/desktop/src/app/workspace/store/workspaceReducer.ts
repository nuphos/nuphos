import { finalizeWorkspaceState } from './workspaceNormalize.ts'
import {
  MAIN_PAGE_BUCKET_KEY,
  selectBucket,
  selectTabLocation,
  teamScopeOf,
} from './workspaceState.ts'
import {
  activateTabIn,
  closeOtherTabsIn,
  closeTabIn,
  mapTabsIn,
  openTabIn,
  reorderTabIn,
  retainTeamsIn,
  selectAdjacentIn,
  selectTabAtIn,
  updateTabIn,
} from './workspaceTabOps.ts'

import type { WorkspaceAction, WorkspaceStoreDeps } from './workspaceActions'
import type { TabBucket, WorkspaceState } from './workspaceState'

function writeBucket(
  state: WorkspaceState,
  sessionKey: string,
  update: (bucket: TabBucket) => TabBucket,
): WorkspaceState {
  const bucket = selectBucket(state, sessionKey)
  const next = update(bucket)

  if (next === bucket) return state

  return { ...state, buckets: { ...state.buckets, [sessionKey]: next } }
}

function writeTabOwner(
  state: WorkspaceState,
  tabId: string,
  update: (bucket: TabBucket) => TabBucket,
): WorkspaceState {
  const location = selectTabLocation(state, tabId)

  return location ? writeBucket(state, location.sessionKey, update) : state
}

function writeEveryBucket(
  state: WorkspaceState,
  update: (bucket: TabBucket) => TabBucket,
): WorkspaceState {
  return Object.keys(state.buckets).reduce((acc, key) => writeBucket(acc, key, update), state)
}

function selectSession(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'selectSession' }>,
): WorkspaceState {
  const teamScope =
    action.teamId && action.teamId !== state.teamScope?.teamId
      ? teamScopeOf(action.teamId)
      : state.teamScope

  const mainPageOpen = action.keepMainPage === true && state.mainPageOpen

  const newChatRequest = action.resetHomeScroll ? state.newChatRequest + 1 : state.newChatRequest

  if (
    newChatRequest === state.newChatRequest &&
    action.sessionId === state.sessionId &&
    action.readOnly === state.sessionReadOnly &&
    teamScope === state.teamScope &&
    mainPageOpen === state.mainPageOpen
  ) {
    return state
  }

  return {
    ...state,
    sessionId: action.sessionId,
    newChatRequest,
    sessionReadOnly: action.readOnly,
    teamScope,
    mainPageOpen,
  }
}

/** The main page keeps its tab (and history) while it stays on the team being opened. */
function openMainPage(
  state: WorkspaceState,
  teamId: string,
  deps: WorkspaceStoreDeps,
): WorkspaceState {
  const next = writeBucket(state, MAIN_PAGE_BUCKET_KEY, (bucket) => {
    const active = bucket.tabs.find((tab) => tab.id === bucket.activeTabId)

    if (active?.scope.teamId === teamId) return bucket
    const tab = deps.createTab(teamId)

    return { ...bucket, tabs: [tab], activeTabId: tab.id }
  })

  return next.mainPageOpen ? next : { ...next, mainPageOpen: true }
}

function retainTeams(
  state: WorkspaceState,
  teamIds: readonly string[],
  preferredTeamId: string | null,
): WorkspaceState {
  const known = new Set(teamIds)
  const retained = writeEveryBucket(state, (bucket) =>
    retainTeamsIn(bucket, (teamId) => known.has(teamId)),
  )
  const next = retained.teamsKnown ? retained : { ...retained, teamsKnown: true }

  if (next.teamScope && known.has(next.teamScope.teamId)) return next

  return { ...next, teamScope: preferredTeamId ? teamScopeOf(preferredTeamId) : null }
}

function removeTeam(state: WorkspaceState, teamId: string): WorkspaceState {
  const next = writeEveryBucket(state, (bucket) => retainTeamsIn(bucket, (id) => id !== teamId))

  return next.teamScope?.teamId === teamId ? { ...next, teamScope: null } : next
}

const WORKSPACE_LEVEL_ACTIONS = new Set<WorkspaceAction['type']>([
  'selectSession',
  'openMainPage',
  'setSessionReadOnly',
  'switchTeam',
  'retainTeams',
  'removeTeam',
])

type WorkspaceLevelAction = Extract<
  WorkspaceAction,
  {
    type:
      | 'selectSession'
      | 'openMainPage'
      | 'setSessionReadOnly'
      | 'switchTeam'
      | 'retainTeams'
      | 'removeTeam'
  }
>
type TabAction = Exclude<WorkspaceAction, WorkspaceLevelAction>

function isTabAction(action: WorkspaceAction): action is TabAction {
  return !WORKSPACE_LEVEL_ACTIONS.has(action.type)
}

function applyTabAction(
  state: WorkspaceState,
  action: TabAction,
  deps: WorkspaceStoreDeps,
): WorkspaceState {
  switch (action.type) {
    case 'setDockOpen':
      return writeBucket(state, action.sessionKey, (bucket) =>
        bucket.dockOpen === action.open && !(action.open && bucket.tabs.length === 0)
          ? bucket
          : { ...bucket, dockOpen: action.open },
      )
    case 'setTabs':
      return writeBucket(state, action.sessionKey, (bucket) =>
        bucket.tabs === action.tabs ? bucket : { ...bucket, tabs: action.tabs },
      )
    case 'openTab':
      return writeBucket(state, action.sessionKey, (bucket) =>
        openTabIn(bucket, action.tab, action.options),
      )
    case 'activateTab':
      return writeBucket(state, action.sessionKey, (bucket) => activateTabIn(bucket, action.tabId))
    case 'openTeamTab':
      return writeBucket(state, action.sessionKey, (bucket) => {
        const existing = bucket.tabs.find((tab) => tab.scope.teamId === action.teamId)

        return existing
          ? activateTabIn(bucket, existing.id)
          : openTabIn(bucket, deps.createTab(action.teamId))
      })
    case 'selectAdjacentTab':
      return writeBucket(state, action.sessionKey, (bucket) =>
        selectAdjacentIn(bucket, action.direction),
      )
    case 'selectTabAt':
      return writeBucket(state, action.sessionKey, (bucket) =>
        selectTabAtIn(bucket, action.position),
      )
    case 'mapTabs':
      return writeBucket(state, action.sessionKey, (bucket) => mapTabsIn(bucket, action.updater))
    case 'closeTab':
      return writeTabOwner(state, action.tabId, (bucket) => closeTabIn(bucket, action.tabId))
    case 'closeOtherTabs':
      return writeTabOwner(state, action.tabId, (bucket) => closeOtherTabsIn(bucket, action.tabId))
    case 'reorderTab':
      return writeTabOwner(state, action.tabId, (bucket) =>
        reorderTabIn(bucket, action.tabId, action.targetTabId, action.placement),
      )
    case 'updateTab':
      return writeTabOwner(state, action.tabId, (bucket) =>
        updateTabIn(bucket, action.tabId, action.updater, action.history),
      )
  }
}

function applyAction(
  state: WorkspaceState,
  action: WorkspaceAction,
  deps: WorkspaceStoreDeps,
): WorkspaceState {
  if (isTabAction(action)) return applyTabAction(state, action, deps)
  switch (action.type) {
    case 'selectSession':
      return selectSession(state, action)
    case 'openMainPage':
      return openMainPage(state, action.teamId, deps)
    case 'setSessionReadOnly':
      return action.readOnly === state.sessionReadOnly
        ? state
        : { ...state, sessionReadOnly: action.readOnly }
    case 'switchTeam': {
      const tab = deps.createTab(action.teamId)
      const next = writeBucket(state, action.sessionKey, (bucket) => ({
        ...bucket,
        tabs: [tab],
        activeTabId: tab.id,
      }))

      return { ...next, teamScope: teamScopeOf(action.teamId) }
    }
    case 'retainTeams':
      return retainTeams(state, action.teamIds, action.preferredTeamId)
    case 'removeTeam':
      return removeTeam(state, action.teamId)
  }
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
  deps: WorkspaceStoreDeps,
): WorkspaceState {
  const next = applyAction(state, action, deps)

  return next === state ? state : finalizeWorkspaceState(state, next, deps)
}
