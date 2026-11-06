import {
  dockHistoryKey,
  parseDockHistory,
  readDockHistorySnapshot,
} from '../../../lib/dockHistory.ts'
import { emptyNavigation } from '../../../lib/app-routes/parseShared.ts'
import { navigationFromAppPath } from '../../../lib/appRoutes.ts'
import { createWorkspaceTabFromNavigation } from '../../workspaceTabFactory.ts'
import { browserViewId, isWatchedDockTab, setWatchedDockTab } from '../watchedDockTabs.ts'

import { dockMirror } from './dockMirror.ts'
import { sessionKeyOf } from './workspaceState.ts'

import type { DockMirror } from './dockMirror'
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

/**
 * The conversation whose dock an agent's browser tab opens in: the agent's own,
 * unless the main pane shows a channel the agent is in. A request made in a
 * channel is answered there, so its tab opens where the person asking sees it.
 */
export function agentTabSession(
  state: WorkspaceState,
  agent: string,
  channelAgents: (channelId: string) => readonly string[],
): string {
  const shown = state.mainPageOpen ? null : state.sessionId

  return shown && channelAgents(shown).includes(agent) ? shown : agent
}

/** How long a watched tab may take to mount and attach its page. */
const ATTACH_TIMEOUT_MS = 15_000

type PaneStore = {
  userId: string
  getState: () => WorkspaceState
  actions: Pick<WorkspaceActions, 'mountTab' | 'closeTab' | 'openTabInSession'>
}

/** A page the phone opens in a dock: an app path from New Tab or history, or a workspace page key. */
type OpenTarget = { href: string } | { page: string }

/** Every split pane's store; a conversation's dock lives in whichever pane holds it. */
const stores = new Set<PaneStore>()

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- merges into Window
  interface Window {
    /** Read by the main process (`dock-mirror.ts`) when the iPhone asks for a dock. */
    nuphosDockMirror?: (sessionId: string, teamId: string) => DockMirror | null
    nuphosCloseDockTab?: (sessionId: string, tabId: string) => boolean
    nuphosOpenDockTab?: (sessionId: string, teamId: string, target: OpenTarget) => string | null
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

/** The pane store holding the conversation's dock, if any pane does. */
const storeWithDock = (sessionId: string) =>
  [...stores].find((store) => store.getState().buckets[sessionKeyOf(sessionId)] !== undefined)

function mirrorDock(sessionId: string, teamId: string): DockMirror | null {
  const store = storeWithDock(sessionId) ?? [...stores][0]

  if (!store) return null
  const history = parseDockHistory(readDockHistorySnapshot(dockHistoryKey(store.userId, teamId)))

  return dockMirror(store.getState(), sessionId, history)
}

function closeDockTab(sessionId: string, tabId: string): boolean {
  const store = [...stores].find((candidate) =>
    candidate.getState().buckets[sessionKeyOf(sessionId)]?.tabs.some((tab) => tab.id === tabId),
  )

  if (!store) return false
  store.actions.closeTab(tabId)

  return true
}

/** Opens a page in the conversation's dock without bringing it on screen; only this team's pages. */
function openDockTab(sessionId: string, teamId: string, target: OpenTarget): string | null {
  const store = storeWithDock(sessionId) ?? [...stores][0]
  const navigation =
    'href' in target
      ? target.href.startsWith(`/teams/${encodeURIComponent(teamId)}/`)
        ? navigationFromAppPath(target.href)
        : null
      : emptyNavigation({ kind: 'team', teamId }, target.page)

  if (!store || navigation?.scope.teamId !== teamId) return null
  const tab = createWorkspaceTabFromNavigation(navigation)

  store.actions.openTabInSession(sessionId, tab)

  return tab.id
}

async function watchDockTab(sessionId: string, tabId: string, width: number, height: number) {
  const store = [...stores].find((candidate) =>
    dockBrowserTabs(candidate.getState(), sessionId).some((tab) => tab.id === tabId),
  )

  // One phone per tab: a second would resize the first's page and end its watch on leaving.
  if (!store || isWatchedDockTab(tabId)) return null
  store.actions.mountTab(sessionId, tabId)
  setWatchedDockTab(tabId, { width, height, sessionId })
  const id = await browserViewId(tabId, ATTACH_TIMEOUT_MS)

  // A page that never attached leaves no watch behind to keep the pane laid out.
  if (id === null) setWatchedDockTab(tabId, null)

  return id
}

/** Mirrors a pane's docks to the main process, and lets the phone change and watch them, while it is mounted. */
export function exposeDockBrowserTabs(store: PaneStore): () => void {
  stores.add(store)
  window.nuphosDockMirror = mirrorDock
  window.nuphosCloseDockTab = closeDockTab
  window.nuphosOpenDockTab = openDockTab
  window.nuphosWatchDockTab = watchDockTab
  window.nuphosUnwatchDockTab = (tabId) => setWatchedDockTab(tabId, null)

  return () => {
    stores.delete(store)
  }
}
