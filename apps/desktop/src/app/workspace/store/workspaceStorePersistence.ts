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
import type {
  PersistedWorkspace,
  PersistedWorkspaceBySession,
  PersistedWorkspaceTab,
} from '../../workspacePersistence'
import type { WorkspaceTabState } from '../../workspaceTabState'

/** Before New Tab existed, the tab factory opened a bare Connectors page;
 *  a saved tab of exactly that shape restores as a New Tab. It is read off
 *  the saved page, since restoring moves any Connectors page to the agent home. */
function isLegacyLauncherTab(persisted: PersistedWorkspaceTab): boolean {
  const history = Array.isArray(persisted.navHistory) ? persisted.navHistory : []
  const [page] = history

  return (
    history.length === 1 &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- untrusted storage
    page.scope?.kind === 'team' &&
    page.active === 'team.integrations' &&
    !page.filter &&
    (page.target ?? null) === null &&
    (page.connectorDetail ?? null) === null &&
    !(page.addIntegrationOpen ?? false)
  )
}

function restoreTab(persisted: PersistedWorkspaceTab): WorkspaceTabState | null {
  const tab = restorePersistedTab(persisted)

  return tab && isLegacyLauncherTab(persisted)
    ? { ...createWorkspaceTab(tab.scope.teamId), id: tab.id }
    : tab
}

function hydrateBucket(persisted: PersistedWorkspace, isDock: boolean): TabBucket | null {
  const restored = persisted.tabs
    .map(restoreTab)
    .filter((tab): tab is WorkspaceTabState => tab !== null)
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

/**
 * Mirrors this store's docks to disk. Every pane of every window has its own
 * store, so each writes only the docks it changed or dropped and leaves the
 * rest of the file to the others. Tab churn that doesn't touch navigation
 * (poll ticks, loading flags) serializes identically and is skipped.
 */
export function persistWorkspaceStore(
  store: WorkspaceStore,
  read: () => PersistedWorkspaceBySession = readPersistedWorkspaceBySession,
  write: (bySession: PersistedWorkspaceBySession) => void = writePersistedWorkspaceBySession,
): () => void {
  let lastBuckets: WorkspaceState['buckets'] | null = null
  let written: Record<string, string> = {}
  const sync = () => {
    const { buckets } = store.getState()

    if (buckets === lastBuckets) return
    lastBuckets = buckets
    const mine = serializeWorkspaceBuckets(buckets)
    const encoded = Object.fromEntries(
      Object.entries(mine).map(([key, value]) => [key, JSON.stringify(value)]),
    )
    const changed = Object.keys(encoded).filter((key) => written[key] !== encoded[key])
    const dropped = Object.keys(written).filter((key) => !(key in encoded))

    written = encoded
    if (changed.length === 0 && dropped.length === 0) return
    const next = Object.fromEntries(
      Object.entries(read()).filter(([key]) => !dropped.includes(key)),
    )

    for (const key of changed) next[key] = mine[key]
    write(next)
  }

  sync()

  return store.subscribe(sync)
}
