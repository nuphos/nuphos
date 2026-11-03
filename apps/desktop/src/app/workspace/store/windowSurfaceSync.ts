import { selectActiveTab } from './workspaceState.ts'

import type { WorkspaceState } from './workspaceState'
import type { WorkspaceStore } from './workspaceStore'
import type { WindowSurface } from '../../../api/window-shell'

export type WindowSurfaceBridge = {
  takeWindowSurface(): Promise<WindowSurface | null>
  reportWindowSurface(surface: WindowSurface): void
}

/** Nothing until the teams arrive: a surface reported before then would lose its team. */
export function windowSurfaceOf(state: WorkspaceState): WindowSurface | null {
  if (!state.teamsKnown) return null
  const mainPageTeam = state.mainPageOpen ? selectActiveTab(state)?.scope.teamId : undefined

  return {
    sessionId: state.sessionId,
    readOnly: state.sessionReadOnly,
    teamId: mainPageTeam ?? state.teamScope?.teamId ?? null,
    mainPageOpen: state.mainPageOpen,
  }
}

/**
 * Shows the saved surface unless something (a deep link) already navigated. A
 * conversation that no longer opens or a team the account left is dropped by
 * the same paths that handle it during a session.
 */
export function applyWindowSurface(store: WorkspaceStore, saved: WindowSurface) {
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
}

/** Restores this window's last surface once, then reports every change of it to the main process. */
export function syncWindowSurface(store: WorkspaceStore, bridge: WindowSurfaceBridge): () => void {
  let stopped = false
  let unsubscribe: (() => void) | null = null

  void bridge
    .takeWindowSurface()
    .catch(() => null)
    .then((saved) => {
      if (stopped) return
      if (saved) applyWindowSurface(store, saved)
      let last: string | null = null
      const report = () => {
        const surface = windowSurfaceOf(store.getState())
        const encoded = surface && JSON.stringify(surface)

        if (!surface || encoded === last) return
        last = encoded
        bridge.reportWindowSurface(surface)
      }

      report()
      unsubscribe = store.subscribe(report)
    })

  return () => {
    stopped = true
    unsubscribe?.()
  }
}
