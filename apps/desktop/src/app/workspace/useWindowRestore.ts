import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

import { api } from '../../api'

import {
  applyPaneSurface,
  createWindowSurfaceReporter,
  restoredPaneBucketKeys,
  restoredPaneSeed,
  restoredWindowSurface,
  windowSurfaceOf,
} from './store/windowSurfaceSync'
import { hydrateWorkspaceState } from './store/workspaceStorePersistence'

import type { SplitLayout } from './splitLayout'
import type { WorkspaceState } from './store/workspaceState'
import type { WorkspaceStore } from './store/workspaceStore'
import type { PaneSurface } from '../../api/window-shell'

type Args = {
  layout: SplitLayout
  setLayout: (layout: SplitLayout) => void
  activeId: string
  setActiveId: (id: string) => void
  stores: Map<string, WorkspaceStore>
  seeds: Map<string, WorkspaceState>
}

/**
 * A relaunch reopens the window as it was left: its split panes, the focused
 * one, and what each pane showed with its dock. From then on every change is
 * reported to the main process, which saves it with the window.
 */
export function useWindowRestore({
  layout,
  setLayout,
  activeId,
  setActiveId,
  stores,
  seeds,
}: Args) {
  const [restored, setRestored] = useState(false)
  const [storesVersion, setStoresVersion] = useState(0)
  const [report] = useState(() => createWindowSurfaceReporter(api))
  const [handle] = useState(() => {
    const pending = new Map<string, PaneSurface>()
    // Pane → the conversation it reopened, until it shows something else.
    const reopened = new Map<string, string>()
    const bump = () => setStoresVersion((version) => version + 1)
    /** Shows a restored pane's saved surface once its store exists. */
    const fill = (id: string, store: WorkspaceStore) => {
      const surface = pending.get(id)

      if (!surface) return
      pending.delete(id)
      applyPaneSurface(store, surface)
    }

    return {
      pending,
      reopened,
      /** Each pane's store as it mounts; a restored pane gets its saved surface. */
      fill,
      register(id: string, store: WorkspaceStore) {
        stores.set(id, store)
        fill(id, store)
        bump()

        return () => {
          stores.delete(id)
          bump()
        }
      },
      /** True when the conversation a pane reopened turned out to be gone. */
      unshown(id: string, sessionId: string) {
        if (reopened.get(id) !== sessionId) return false
        reopened.delete(id)

        return true
      },
    }
  })

  useEffect(() => {
    let stopped = false

    void api
      .takeWindowSurface()
      .catch(() => null)
      .then((saved) => {
        if (stopped) return
        if (saved) {
          const surface = restoredWindowSurface(saved, 'primary')

          const first = stores.get('primary')
          const loaded = first?.getState() ?? hydrateWorkspaceState()

          for (const [id, pane] of Object.entries(surface.panes)) {
            if (pane.sessionId) handle.reopened.set(id, pane.sessionId)
            handle.pending.set(id, pane)
            if (id === 'primary') continue
            // The first pane loaded every dock; each split pane takes its own over.
            seeds.set(id, restoredPaneSeed(pane, loaded))
            first?.actions.releaseBuckets(restoredPaneBucketKeys(pane))
          }
          // Focus first: a pane that opens its chat while focused takes the keyboard.
          flushSync(() => {
            setLayout(surface.layout)
            setActiveId(surface.activeId)
          })
          for (const [id, store] of stores) handle.fill(id, store)
        }
        setRestored(true)
      })

    return () => {
      stopped = true
    }
  }, [handle, seeds, setActiveId, setLayout, stores])

  useEffect(() => {
    if (!restored) return
    const sync = () => {
      const surface = windowSurfaceOf(layout, activeId, stores)

      if (!surface) return
      for (const [id, sessionId] of handle.reopened) {
        const showing = Object.hasOwn(surface.panes, id) && surface.panes[id].sessionId

        if (showing !== sessionId) handle.reopened.delete(id)
      }
      report(surface)
    }
    const stops = [...stores.values()].map((store) => store.subscribe(sync))

    sync()

    return () => {
      for (const stop of stops) stop()
    }
  }, [restored, layout, activeId, storesVersion, stores, handle, report])

  return handle
}
