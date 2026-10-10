import { useEffect, useState, useSyncExternalStore } from 'react'

import { useWorkspacePane } from '../WorkspacePaneContext'

import { selectCurrentBucket, selectScope } from './workspaceState'
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
  }
}

export type WorkspaceStoreResult = ReturnType<typeof useWorkspaceStore>
