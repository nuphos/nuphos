import { isTeamManagementKey } from '../../../lib/teamOverviewNav.ts'
import { NO_SESSION_TAB_BUCKET_KEY } from '../../workspaceTabState.ts'

import type { Scope } from '../../../types'
import type { WorkspaceTabState } from '../../workspaceTabState'

export type TeamScope = Extract<Scope, { kind: 'team' }>

/** One chat session's dock: its tab strip, focused tab, keep-alive set and
 *  open/closed state. `dockOpen` is runtime-only and never persisted. */
export type TabBucket = {
  tabs: WorkspaceTabState[]
  activeTabId: string | null
  mountedTabIds: ReadonlySet<string>
  dockOpen: boolean
}

export type WorkspaceState = {
  /** The chat session shown in the main pane; its bucket is the visible dock. */
  sessionId: string | null
  /** A management page replaces the chat surface; its tab lives in the main-page bucket. */
  mainPageOpen: boolean
  /** Runtime-only signal for repeated explicit New chat navigation. */
  newChatRequest: number
  sessionReadOnly: boolean
  /** Team identity for a session whose dock has no active tab to name one. */
  teamScope: TeamScope | null
  /** False until the account's teams arrive; restored tabs may name a team it has left. */
  teamsKnown: boolean
  buckets: Readonly<Record<string, TabBucket>>
  /** Session keys, least- to most-recently touched, for the resident cap. */
  recentSessionKeys: readonly string[]
}

export const EMPTY_BUCKET: TabBucket = {
  tabs: [],
  activeTabId: null,
  mountedTabIds: new Set(),
  dockOpen: false,
}

export const MAIN_PAGE_BUCKET_KEY = '__main-page__'

/** Management pages only ever live in the main pane, never in a dock tab. */
export function isManagementTab(tab: WorkspaceTabState): boolean {
  return tab.scope.kind === 'team' && isTeamManagementKey(tab.active)
}

export function sessionKeyOf(sessionId: string | null): string {
  return sessionId ?? NO_SESSION_TAB_BUCKET_KEY
}

/** The bucket behind whatever the main pane shows: the management page's, or the chat's dock. */
export function currentSessionKey(state: WorkspaceState): string {
  return state.mainPageOpen ? MAIN_PAGE_BUCKET_KEY : sessionKeyOf(state.sessionId)
}

export function selectBucket(state: WorkspaceState, sessionKey: string): TabBucket {
  return state.buckets[sessionKey] ?? EMPTY_BUCKET
}

export function selectCurrentBucket(state: WorkspaceState): TabBucket {
  return selectBucket(state, currentSessionKey(state))
}

export function selectActiveTab(state: WorkspaceState): WorkspaceTabState | null {
  const bucket = selectCurrentBucket(state)

  return bucket.tabs.find((tab) => tab.id === bucket.activeTabId) ?? null
}

/** The active dock tab's scope wins (it can be narrower than a team); an empty
 *  dock falls back to the workspace's team rather than to no scope at all. No
 *  scope until the teams are known, so nothing loads for a team the account left. */
export function selectScope(state: WorkspaceState): Scope | null {
  if (!state.teamsKnown) return null

  return selectActiveTab(state)?.scope ?? state.teamScope
}

export function selectTabLocation(
  state: WorkspaceState,
  tabId: string,
): { sessionKey: string; tab: WorkspaceTabState } | null {
  const preferred = currentSessionKey(state)
  const keys = [preferred, ...Object.keys(state.buckets).filter((key) => key !== preferred)]

  for (const sessionKey of keys) {
    const tab = selectBucket(state, sessionKey).tabs.find((item) => item.id === tabId)

    if (tab) return { sessionKey, tab }
  }

  return null
}

export function selectAllResidentTabs(state: WorkspaceState): WorkspaceTabState[] {
  return Object.values(state.buckets).flatMap((bucket) => bucket.tabs)
}

/**
 * Browser tabs from every resident session, not just the visible one, and only
 * those whose page has actually been opened.
 *
 * A browser tab's state *is* its `<webview>` element: Electron destroys the
 * guest the moment that element leaves the DOM, and even reparenting it within
 * the document reloads the page. So the one way a browser tab can survive the
 * dock swapping chat session is for its pane never to unmount — which means the
 * main pane has to render it whether or not its session is the current one.
 * Restricting this to tabs their own bucket already mounted keeps a restored
 * tab from loading a page nobody has looked at yet.
 */
export function selectMountedBrowserTabs(
  buckets: Readonly<Record<string, TabBucket>>,
): WorkspaceTabState[] {
  return Object.values(buckets).flatMap((bucket) =>
    bucket.tabs.filter(
      (tab) =>
        tab.active === 'team.browser' &&
        (tab.id === bucket.activeTabId || bucket.mountedTabIds.has(tab.id)),
    ),
  )
}

export function teamScopeOf(teamId: string): TeamScope {
  return { kind: 'team', teamId }
}

export function createWorkspaceState(
  buckets: Readonly<Record<string, TabBucket>> = {},
): WorkspaceState {
  return {
    sessionId: null,
    mainPageOpen: false,
    sessionReadOnly: false,
    newChatRequest: 0,
    teamScope: null,
    teamsKnown: false,
    buckets,
    recentSessionKeys: Object.keys(buckets),
  }
}

/** The sidebar follows the page it navigates: the main page, or the dock's
 *  page while an expanded dock gives the sidebar that page's navigation. */
export function sidebarSurface(mainPageOpen: boolean, dockExpanded: boolean, pageActive: string) {
  const dynamicNavigation = dockExpanded && !mainPageOpen

  return {
    dynamicNavigation,
    active: mainPageOpen || dynamicNavigation ? pageActive : '',
    chatShown: !mainPageOpen,
  }
}
