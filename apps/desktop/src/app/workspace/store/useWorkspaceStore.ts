import { useEffect, useState, useSyncExternalStore } from 'react'

import { api } from '../../../api'
import { useWorkspacePane } from '../WorkspacePaneContext'

import { syncWindowSurface } from './windowSurfaceSync'
import { selectCurrentBucket, selectHistoryStep, selectScope } from './workspaceState'
import { createWorkspaceStore } from './workspaceStore'
import { hydrateWorkspaceState, persistWorkspaceStore } from './workspaceStorePersistence'

/**
 * One store per mounted workspace (logout unmounts it, so nothing leaks to the
 * next account). Render-time values are read off the snapshot; every write goes
 * through `workspaceActions`, whose identity never changes.
 */
export function useWorkspaceStore() {
  const pane = useWorkspacePane()
  const initialState = pane?.initialState
  const primary = pane?.primary ?? true
  const registerStore = pane?.registerStore
  const [workspaceStore] = useState(() =>
    createWorkspaceStore(initialState ?? hydrateWorkspaceState()),
  )
  const state = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getState,
    workspaceStore.getState,
  )

  useEffect(() => registerStore?.(workspaceStore), [registerStore, workspaceStore])
  useEffect(() => {
    if (primary) return persistWorkspaceStore(workspaceStore)
  }, [primary, workspaceStore])
  useEffect(() => {
    if (primary) return syncWindowSurface(workspaceStore, api)
  }, [primary, workspaceStore])
  const bucket = selectCurrentBucket(state)

  return {
    workspaceStore,
    workspaceActions: workspaceStore.actions,
    tabBuckets: state.buckets,
    tabs: bucket.tabs,
    activeTabId: bucket.activeTabId,
    mountedTabIds: bucket.mountedTabIds,
    dockOpen: bucket.dockOpen,
    selectedSessionId: state.sessionId,
    newChatRequest: state.newChatRequest,
    mainPageOpen: state.mainPageOpen,
    selectedSessionReadOnly: state.sessionReadOnly,
    workspaceScope: selectScope(state),
    canGoBack: selectHistoryStep(state, -1) !== null,
    canGoForward: selectHistoryStep(state, 1) !== null,
    surfaceHistory: state.surfaceHistory,
    surfaceHistoryIndex: state.surfaceHistoryIndex,
  }
}

export type WorkspaceStoreResult = ReturnType<typeof useWorkspaceStore>
