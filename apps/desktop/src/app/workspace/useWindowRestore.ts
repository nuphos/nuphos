import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

import { api } from '../../api'
import { isConversationUnavailable } from '../../api/errors'
import { useStableCallback } from '../../hooks/useStableCallback'

import {
  applyPaneSurface,
  createWindowSurfaceReporter,
  restoredPaneBucketKeys,
  restoredPaneSeed,
  restoredWindowSurface,
  paneIdsOf,
  windowSurfaceOf,
} from './store/windowSurfaceSync'
import { hydrateWorkspaceState } from './store/workspaceStorePersistence'

import type { SplitLayout } from './splitLayout'
import type { WorkspaceState } from './store/workspaceState'
import type { WorkspaceStore } from './store/workspaceStore'
import type { PaneSurface } from '../../api/window-shell'

const RETRY_MS = 5000

type Args = {
  layout: SplitLayout
  setLayout: (layout: SplitLayout) => void
  activeId: string
  setActiveId: (id: string) => void
  stores: Map<string, WorkspaceStore>
  seeds: Map<string, WorkspaceState>
  /** Closes a pane the way its close button does. */
  close: (id: string) => void
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
  close,
}: Args) {
  const [restored, setRestored] = useState(false)
  // Only a split pane closes: the window's last one stays, showing why the chat is gone.
  const closeGone = useStableCallback((id: string) => {
    if (paneIdsOf(layout).length > 1 && paneIdsOf(layout).includes(id)) close(id)
  })
  const [storesVersion, setStoresVersion] = useState(0)
  const [report] = useState(() => createWindowSurfaceReporter(api))
  const [handle] = useState(() => {
    const pending = new Map<string, PaneSurface>()
    // Restored panes whose conversation the backend has not answered for yet.
    const unconfirmed = new Set<string>()
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
      unconfirmed,
      bump,
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
    }
  })

  useEffect(() => {
    let stopped = false
    // Only a conversation the backend says is gone or forbidden is skipped. An
    // outage at launch is retried, and nothing is saved until it is answered.
    const check = (id: string, pane: PaneSurface & { sessionId: string }) => {
      handle.unconfirmed.add(id)
      const settle = () => {
        handle.unconfirmed.delete(id)
        handle.bump()
      }

      api
        .agentGetConversation(pane.sessionId, pane.teamId ?? undefined, {
          messages: 'omit',
          runtimeState: 'omit',
        })
        .then(() => {
          if (stopped) return
          const store = stores.get(id)

          // An open that failed during the outage left the pane blank; show it now.
          if (store) applyPaneSurface(store, pane)
          settle()
        })
        .catch((error: unknown) => {
          if (stopped) return
          if (stores.has(id) && !isConversationUnavailable(error)) {
            setTimeout(() => !stopped && check(id, pane), RETRY_MS)

            return
          }
          if (stores.has(id)) closeGone(id)
          settle()
        })
    }

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
            handle.pending.set(id, pane)
            if (pane.sessionId) check(id, { ...pane, sessionId: pane.sessionId })
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
  }, [closeGone, handle, seeds, setActiveId, setLayout, stores])

  useEffect(() => {
    if (!restored) return
    const sync = () => {
      const surface = windowSurfaceOf(layout, activeId, stores)

      const waiting = paneIdsOf(layout).some((id) => handle.unconfirmed.has(id))

      if (surface && !waiting) report(surface)
    }
    const stops = [...stores.values()].map((store) => store.subscribe(sync))

    sync()

    return () => {
      for (const stop of stops) stop()
    }
  }, [restored, layout, activeId, storesVersion, stores, handle, report])

  return handle
}
