import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { serializeWorkspace } from '../../workspacePersistence.ts'
import { createWorkspaceTab } from '../../workspaceTabFactory.ts'
import {
  LEGACY_WORKSPACE_TABS_STORAGE_KEY,
  NO_SESSION_TAB_BUCKET_KEY,
  WORKSPACE_TABS_STORAGE_KEY,
} from '../../workspaceTabState.ts'

import { createWorkspaceStore } from './workspaceStore.ts'
import {
  hydrateWorkspaceState,
  persistWorkspaceStore,
  serializeWorkspaceBuckets,
} from './workspaceStorePersistence.ts'

import type { PersistedWorkspaceBySession } from '../../workspacePersistence'

const TEAM = 'cccccccccccccccccccccccc'
const storage = new Map<string, string>()

Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
})

beforeEach(() => storage.clear())

function persistedStrip(count: number, activeIndex: number) {
  const tabs = Array.from({ length: count }, () => ({
    ...createWorkspaceTab(TEAM),
    active: 'team.monitoring',
  }))
  const persisted = serializeWorkspace(tabs, tabs[activeIndex].id)

  assert.ok(persisted)

  return persisted
}

test('hydrates each session’s strip with its active tab and a closed dock', () => {
  const state = hydrateWorkspaceState({ 'session-a': persistedStrip(3, 1) })
  const bucket = state.buckets['session-a']

  assert.equal(bucket.tabs.length, 3)
  assert.equal(bucket.activeTabId, bucket.tabs[1].id)
  assert.equal(bucket.dockOpen, false)
})

test('adopts the pre-per-session strip as the no-session bucket', () => {
  storage.set(LEGACY_WORKSPACE_TABS_STORAGE_KEY, JSON.stringify(persistedStrip(2, 0)))

  const state = hydrateWorkspaceState()

  assert.deepEqual(Object.keys(state.buckets), [NO_SESSION_TAB_BUCKET_KEY])
  assert.equal(state.buckets[NO_SESSION_TAB_BUCKET_KEY].tabs.length, 2)
})

test('upgrades a restored legacy Connectors launcher tab to a New Tab', () => {
  const launcher = { ...createWorkspaceTab(TEAM), active: 'team.integrations' }
  const persisted = serializeWorkspace(
    [{ ...launcher, navHistory: [{ ...launcher.navHistory[0], active: 'team.integrations' }] }],
    launcher.id,
  )

  assert.ok(persisted)
  const state = hydrateWorkspaceState({ s: persisted })

  assert.equal(state.buckets.s.tabs[0].active, 'team.new-tab')
})

test('restores a Cost Management tab as Dashboards with its open dashboard', () => {
  const tab = createWorkspaceTab(TEAM)
  const legacySnapshot = {
    ...tab.navHistory[0],
    active: 'team.cost-management',
    costDashboard: { dashboardId: 'dash-1', dashboardName: 'AWS spend' },
  }
  const state = hydrateWorkspaceState({
    s: {
      tabs: [
        { navHistory: [legacySnapshot], navHistoryIndex: 0, title: 'AWS spend' },
        { navHistory: [{ ...legacySnapshot, costDashboard: null }], title: 'Cost Management' },
      ] as PersistedWorkspaceBySession[string]['tabs'],
      activeIndex: 0,
    },
  })
  const [open, list] = state.buckets.s.tabs

  assert.equal(open.active, 'team.dashboards')
  assert.deepEqual(open.nuphosDashboard, { dashboardId: 'dash-1', dashboardName: 'AWS spend' })
  assert.equal(open.navHistory[0].active, 'team.dashboards')
  assert.equal(open.restoredTitle, 'AWS spend')
  assert.equal(list.active, 'team.dashboards')
  assert.equal(list.nuphosDashboard, null)
  assert.equal(list.restoredTitle, 'Dashboards')
})

test('writes every resident session and skips churn that does not change navigation', () => {
  const writes: PersistedWorkspaceBySession[] = []
  const store = createWorkspaceStore(hydrateWorkspaceState({ 'session-a': persistedStrip(1, 0) }))
  const stop = persistWorkspaceStore(store, (bySession) => writes.push(bySession))

  assert.equal(writes.length, 1)
  store.actions.selectSession('session-a')
  store.actions.updateActiveTab((tab) => ({ ...tab, pollTick: tab.pollTick + 1 }))
  assert.equal(writes.length, 1)

  store.actions.updateActiveTab((tab) => ({ ...tab, active: 'team.plans' }))
  assert.equal(writes.length, 2)
  assert.deepEqual(writes[1], serializeWorkspaceBuckets(store.getState().buckets))
  stop()
})

test('round-trips through the per-session storage key', () => {
  const store = createWorkspaceStore(hydrateWorkspaceState({ 'session-a': persistedStrip(2, 1) }))
  const stop = persistWorkspaceStore(store)

  stop()
  assert.ok(storage.has(WORKSPACE_TABS_STORAGE_KEY))
  const reloaded = hydrateWorkspaceState()

  assert.equal(reloaded.buckets['session-a'].tabs.length, 2)
  assert.equal(reloaded.buckets['session-a'].activeTabId, reloaded.buckets['session-a'].tabs[1].id)
})
