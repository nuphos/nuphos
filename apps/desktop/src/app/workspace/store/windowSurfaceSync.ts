import {
  createWorkspaceState,
  selectActiveTab,
  selectCurrentBucket,
  sessionKeyOf,
  teamScopeOf,
} from './workspaceState.ts'

import type { WorkspaceState } from './workspaceState'
import type { WorkspaceStore } from './workspaceStore'
import type { PaneLayout, PaneSurface, WindowSurface } from '../../../api/window-shell'

/** Nothing until the teams arrive: a surface reported before then would lose its team. */
export function paneSurfaceOf(state: WorkspaceState): PaneSurface | null {
  if (!state.teamsKnown) return null
  const mainPageTeam = state.mainPageOpen ? selectActiveTab(state)?.scope.teamId : undefined

  return {
    sessionId: state.sessionId,
    readOnly: state.sessionReadOnly,
    teamId: mainPageTeam ?? state.teamScope?.teamId ?? null,
    mainPageOpen: state.mainPageOpen,
    dockOpen: !state.mainPageOpen && selectCurrentBucket(state).dockOpen,
  }
}

export function paneIdsOf(layout: PaneLayout): string[] {
  return 'id' in layout ? [layout.id] : layout.children.flatMap(paneIdsOf)
}

/** Nothing until every pane has a store that knows its teams. */
export function windowSurfaceOf(
  layout: PaneLayout,
  activeId: string,
  stores: ReadonlyMap<string, Pick<WorkspaceStore, 'getState'>>,
): WindowSurface | null {
  const panes: Record<string, PaneSurface> = {}

  for (const id of paneIdsOf(layout)) {
    const state = stores.get(id)?.getState()
    const pane = state && paneSurfaceOf(state)

    if (!pane) return null
    panes[id] = pane
  }

  return { layout, activeId, panes }
}

/**
 * Shows the saved surface unless something (a deep link) already navigated. A
 * conversation that no longer opens or a team the account left is dropped by
 * the same paths that handle it during a session.
 */
export function applyPaneSurface(store: WorkspaceStore, saved: PaneSurface) {
  const state = store.getState()

  if (state.sessionId !== null || state.mainPageOpen) return
  if (saved.mainPageOpen && saved.teamId) {
    store.actions.openMainPage(saved.teamId)
  } else if (saved.sessionId || saved.teamId) {
    store.actions.selectSession(saved.sessionId, {
      readOnly: saved.readOnly,
      teamId: saved.teamId ?? undefined,
    })
  }
  // A dock whose tabs are gone stays closed rather than opening on a New Tab.
  if (saved.dockOpen && selectCurrentBucket(store.getState()).tabs.length > 0) {
    store.actions.setDockOpen(true)
  }
}

/** The saved window, its first pane renamed to the pane that is already mounted. */
export function restoredWindowSurface(saved: WindowSurface, mountedId: string): WindowSurface {
  const first = paneIdsOf(saved.layout)[0]
  const swap = new Map([
    [first, mountedId],
    [mountedId, first],
  ])
  const rename = (id: string) => swap.get(id) ?? id
  const relabel = (layout: PaneLayout): PaneLayout =>
    'id' in layout
      ? { id: rename(layout.id) }
      : { ...layout, children: layout.children.map(relabel) }

  return {
    layout: relabel(saved.layout),
    activeId: rename(saved.activeId),
    panes: Object.fromEntries(Object.entries(saved.panes).map(([id, pane]) => [rename(id), pane])),
  }
}

/** The docks a restored split pane takes from the first pane, which loaded every dock. */
export function restoredPaneBucketKeys(pane: PaneSurface): string[] {
  return pane.mainPageOpen ? [] : [sessionKeyOf(pane.sessionId)]
}

/** A restored split pane starts in its saved team with its docks, handed over from `from`. */
export function restoredPaneSeed(pane: PaneSurface, from: WorkspaceState): WorkspaceState {
  const keys = restoredPaneBucketKeys(pane)

  return {
    ...createWorkspaceState(
      Object.fromEntries(Object.entries(from.buckets).filter(([key]) => keys.includes(key))),
    ),
    teamScope: pane.teamId ? teamScopeOf(pane.teamId) : null,
    teamsKnown: true,
  }
}

/** Reports a window's surface to the main process each time it changes. */
export function createWindowSurfaceReporter(bridge: {
  reportWindowSurface(surface: WindowSurface): void
}) {
  let last: string | null = null

  return (surface: WindowSurface) => {
    const encoded = JSON.stringify(surface)

    if (encoded === last) return
    last = encoded
    bridge.reportWindowSurface(surface)
  }
}
