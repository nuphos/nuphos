import {
  readPersistedWorkspaceBySession,
  restorePersistedTab,
  serializeWorkspace,
  writePersistedWorkspaceBySession,
} from '../../workspacePersistence.ts'
import { createWorkspaceTab } from '../../workspaceTabFactory.ts'

import { MAIN_PAGE_BUCKET_KEY, createWorkspaceState, isManagementTab } from './workspaceState.ts'

import type { TabBucket, WorkspaceState } from './workspaceState'
import type { WorkspaceStore } from './workspaceStore'
import type { PersistedWorkspace, PersistedWorkspaceBySession } from '../../workspacePersistence'
import type { WorkspaceTabState } from '../../workspaceTabState'

/** Before New Tab existed, the tab factory opened a bare Connectors page;
 *  a restored tab of exactly that shape becomes a New Tab. */
function upgradeLegacyLauncherTab(tab: WorkspaceTabState): WorkspaceTabState {
  const isLegacyLauncher =
    tab.scope.kind === 'team' &&
    tab.active === 'team.integrations' &&
    tab.filter === '' &&
    tab.navHistory.length === 1 &&
    tab.navHistoryIndex === 0 &&
    tab.target === null &&
    (tab.connectorDetail ?? null) === null &&
    !(tab.addIntegrationOpen ?? false)

  return isLegacyLauncher ? { ...createWorkspaceTab(tab.scope.teamId), id: tab.id } : tab
}

function hydrateBucket(persisted: PersistedWorkspace, isDock: boolean): TabBucket | null {
  const restored = persisted.tabs
    .map(restorePersistedTab)
    .filter((tab): tab is WorkspaceTabState => tab !== null)
    .map(upgradeLegacyLauncherTab)
    .filter((tab) => !isDock || !isManagementTab(tab))

  if (restored.length === 0) return null
  const activeIndex = Math.min(Math.max(0, persisted.activeIndex), restored.length - 1)

  return {
    tabs: restored,
    activeTabId: restored[activeIndex].id,
    mountedTabIds: new Set(),
    dockOpen: false,
  }
}

/** Every persisted session's dock is hydrated once, up front: the on-disk set
 *  is already capped, and hydrating lazily would flicker on each switch. */
export function hydrateWorkspaceState(
  persisted: PersistedWorkspaceBySession = readPersistedWorkspaceBySession(),
): WorkspaceState {
  const buckets: Record<string, TabBucket> = {}

  for (const [key, snapshot] of Object.entries(persisted)) {
    const bucket = hydrateBucket(snapshot, key !== MAIN_PAGE_BUCKET_KEY)

    if (bucket) buckets[key] = bucket
  }

  return createWorkspaceState(buckets)
}

export function serializeWorkspaceBuckets(
  buckets: WorkspaceState['buckets'],
): PersistedWorkspaceBySession {
  const bySession: PersistedWorkspaceBySession = {}

  for (const [key, bucket] of Object.entries(buckets)) {
    const serialized = serializeWorkspace(bucket.tabs, bucket.activeTabId)

    if (serialized) bySession[key] = serialized
  }

  return bySession
}

/** Mirrors every resident session's dock to disk. Tab churn that doesn't touch
 *  navigation (poll ticks, loading flags) serializes identically and is skipped. */
export function persistWorkspaceStore(
  store: WorkspaceStore,
  write: (bySession: PersistedWorkspaceBySession) => void = writePersistedWorkspaceBySession,
): () => void {
  let lastBuckets: WorkspaceState['buckets'] | null = null
  let lastEncoded: string | null = null
  const sync = () => {
    const { buckets } = store.getState()

    if (buckets === lastBuckets) return
    lastBuckets = buckets
    const bySession = serializeWorkspaceBuckets(buckets)
    const encoded = JSON.stringify(bySession)

    if (encoded === lastEncoded) return
    lastEncoded = encoded
    write(bySession)
  }

  sync()

  return store.subscribe(sync)
}
