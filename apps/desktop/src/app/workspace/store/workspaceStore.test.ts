import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createWorkspaceTab } from '../../workspaceTabFactory.ts'
import {
  MAX_RESIDENT_SESSION_TAB_BUCKETS,
  NO_SESSION_TAB_BUCKET_KEY,
} from '../../workspaceTabState.ts'

import {
  createWorkspaceState,
  selectActiveTab,
  selectBucket,
  selectCurrentBucket,
  selectScope,
} from './workspaceState.ts'
import { createWorkspaceStore } from './workspaceStore.ts'

import type { WorkspaceTabState } from '../../workspaceTabState'

const TEAM_A = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const TEAM_B = 'bbbbbbbbbbbbbbbbbbbbbbbb'

function setup() {
  let seq = 0
  const createTab = (teamId: string): WorkspaceTabState => ({
    ...createWorkspaceTab(teamId),
    id: `tab-${String(++seq)}`,
  })
  const store = createWorkspaceStore(createWorkspaceState(), { createTab })

  return { store, actions: store.actions, createTab }
}

function tabIds(tabs: WorkspaceTabState[]) {
  return tabs.map((tab) => tab.id)
}

test('switching into a session with no tabs keeps the team scope', () => {
  const { store, actions } = setup()

  actions.retainTeams([TEAM_A], TEAM_A)
  actions.setDockOpen(true)
  actions.updateActiveTab((tab) => ({ ...tab, active: 'team.plans' }))
  assert.equal(selectScope(store.getState())?.teamId, TEAM_A)

  actions.selectSession('session-empty')

  assert.equal(selectCurrentBucket(store.getState()).tabs.length, 0)
  assert.deepEqual(selectScope(store.getState()), { kind: 'team', teamId: TEAM_A })
})

test('entering another team’s conversation moves the team scope with it', () => {
  const { store, actions } = setup()

  actions.retainTeams([TEAM_A, TEAM_B], TEAM_A)
  actions.selectSession('session-b', { teamId: TEAM_B })

  assert.deepEqual(selectScope(store.getState()), { kind: 'team', teamId: TEAM_B })
  assert.equal(selectBucket(store.getState(), NO_SESSION_TAB_BUCKET_KEY).tabs.length, 0)
})

test('a tab update after a session switch lands on the tab’s own session', () => {
  const { store, actions } = setup()

  actions.retainTeams([TEAM_A], TEAM_A)
  actions.selectSession('session-a')
  actions.setDockOpen(true)
  const tabId = selectCurrentBucket(store.getState()).activeTabId

  assert.ok(tabId)
  actions.selectSession('session-b')
  actions.updateTab(tabId, (tab) => ({ ...tab, clusterLabel: 'prod' }))

  const tabA = selectBucket(store.getState(), 'session-a').tabs.find((tab) => tab.id === tabId)

  assert.equal(tabA?.clusterLabel, 'prod')
  assert.equal(selectBucket(store.getState(), 'session-b').tabs.length, 0)
})

test('actions bound before a session switch act on the session current when they run', () => {
  const { store, actions, createTab } = setup()
  const { switchTeam, openTab } = actions

  actions.retainTeams([TEAM_A, TEAM_B], TEAM_A)
  actions.selectSession('session-a')
  actions.setDockOpen(true)
  const sessionATabs = tabIds(selectCurrentBucket(store.getState()).tabs)

  actions.selectSession('session-b')
  switchTeam(TEAM_B)
  openTab(createTab(TEAM_B))

  assert.deepEqual(tabIds(selectBucket(store.getState(), 'session-a').tabs), sessionATabs)
  assert.equal(selectBucket(store.getState(), 'session-b').tabs.length, 2)
  assert.deepEqual(selectScope(store.getState()), { kind: 'team', teamId: TEAM_B })
})

test('dockOpen sticks on a session that has no tabs', () => {
  const { store, actions } = setup()

  actions.selectSession('session-a')
  actions.setDockOpen(true)
  assert.equal(selectCurrentBucket(store.getState()).dockOpen, true)
  assert.equal(selectCurrentBucket(store.getState()).tabs.length, 0)

  actions.selectSession('session-b')
  actions.selectSession('session-a')
  assert.equal(selectCurrentBucket(store.getState()).dockOpen, true)
})

test('opening an empty dock seeds exactly one tab', () => {
  const { store, actions } = setup()

  actions.retainTeams([TEAM_A], TEAM_A)
  actions.selectSession('session-a')
  actions.setDockOpen(true)
  actions.setDockOpen(true)
  actions.toggleDock()
  actions.toggleDock()

  const bucket = selectCurrentBucket(store.getState())

  assert.equal(bucket.dockOpen, true)
  assert.equal(bucket.tabs.length, 1)
  assert.equal(bucket.activeTabId, bucket.tabs[0].id)
  assert.equal(bucket.tabs[0].scope.teamId, TEAM_A)
})

test('closing the last tab drops the bucket; a field-only update on an empty one does not', () => {
  const { store, actions } = setup()

  actions.retainTeams([TEAM_A], TEAM_A)
  actions.selectSession('session-a')
  actions.setDockOpen(true)
  const tabId = selectCurrentBucket(store.getState()).activeTabId

  assert.ok(tabId)
  actions.closeTab(tabId)
  assert.equal('session-a' in store.getState().buckets, false)
  assert.deepEqual(selectScope(store.getState()), { kind: 'team', teamId: TEAM_A })

  actions.removeTeam(TEAM_A)
  actions.selectSession('session-b')
  actions.setDockOpen(true)
  assert.equal('session-b' in store.getState().buckets, true)
  assert.equal(selectCurrentBucket(store.getState()).dockOpen, true)
})

test('a tab opened into a freshly seeded dock replaces the seed', () => {
  const { store, actions, createTab } = setup()

  actions.retainTeams([TEAM_A], TEAM_A)
  actions.setDockOpen(true)
  const target = { ...createTab(TEAM_A), active: 'team.plans' }

  actions.openTab(target, { replaceLoneFreshTab: true })

  assert.deepEqual(tabIds(selectCurrentBucket(store.getState()).tabs), [target.id])
})

test('closing a tab falls back to its left neighbour and keeps the dock open', () => {
  const { store, actions, createTab } = setup()

  actions.retainTeams([TEAM_A], TEAM_A)
  actions.setDockOpen(true)
  actions.openTab(createTab(TEAM_A))
  actions.openTab(createTab(TEAM_A))
  const [first, second, third] = tabIds(selectCurrentBucket(store.getState()).tabs)

  actions.activateTab(second)
  actions.closeTab(second)

  const bucket = selectCurrentBucket(store.getState())

  assert.deepEqual(tabIds(bucket.tabs), [first, third])
  assert.equal(bucket.activeTabId, first)
  assert.equal(bucket.dockOpen, true)
})

test('switchTeam replaces the current session’s strip only', () => {
  const { store, actions } = setup()

  actions.retainTeams([TEAM_A, TEAM_B], TEAM_A)
  actions.selectSession('session-a')
  actions.setDockOpen(true)
  const sessionATabs = tabIds(selectCurrentBucket(store.getState()).tabs)

  actions.selectSession('session-b')
  actions.switchTeam(TEAM_B)

  assert.deepEqual(tabIds(selectBucket(store.getState(), 'session-a').tabs), sessionATabs)
  assert.equal(selectActiveTab(store.getState())?.scope.teamId, TEAM_B)
})

test('the keep-alive set tracks visited tabs and forgets closed ones', () => {
  const { store, actions, createTab } = setup()

  actions.retainTeams([TEAM_A], TEAM_A)
  actions.setDockOpen(true)
  const [first] = tabIds(selectCurrentBucket(store.getState()).tabs)
  const second = createTab(TEAM_A)

  actions.openTab(second)
  assert.deepEqual(
    [...selectCurrentBucket(store.getState()).mountedTabIds].sort(),
    [first, second.id].sort(),
  )

  actions.closeTab(first)
  assert.deepEqual([...selectCurrentBucket(store.getState()).mountedTabIds], [second.id])
})

test('the resident cap evicts the least recently touched session, never the visible one', () => {
  const { store, actions } = setup()

  actions.retainTeams([TEAM_A], TEAM_A)
  for (let i = 0; i <= MAX_RESIDENT_SESSION_TAB_BUCKETS; i += 1) {
    actions.selectSession(`session-${String(i)}`)
    actions.setDockOpen(true)
  }

  const keys = Object.keys(store.getState().buckets)

  assert.equal(keys.length, MAX_RESIDENT_SESSION_TAB_BUCKETS)
  assert.equal(keys.includes('session-0'), false)
  assert.equal(keys.includes(`session-${String(MAX_RESIDENT_SESSION_TAB_BUCKETS)}`), true)
})

test('an update that navigates records history; restore does not', () => {
  const { store, actions } = setup()

  actions.retainTeams([TEAM_A], TEAM_A)
  actions.setDockOpen(true)
  actions.updateActiveTab((tab) => ({ ...tab, active: 'team.plans' }))
  assert.equal(selectActiveTab(store.getState())?.navHistory.length, 2)

  actions.updateActiveTab((tab) => ({ ...tab, active: 'team.monitoring' }), { history: 'restore' })
  assert.equal(selectActiveTab(store.getState())?.navHistory.length, 2)
})

test('dropping a team clears its tabs from every session and its scope', () => {
  const { store, actions, createTab } = setup()

  actions.retainTeams([TEAM_A, TEAM_B], TEAM_A)
  actions.selectSession('session-a')
  actions.openTab(createTab(TEAM_A))
  actions.selectSession('session-b')
  actions.openTab(createTab(TEAM_B))

  actions.retainTeams([TEAM_A], TEAM_A)
  assert.equal('session-b' in store.getState().buckets, false)
  assert.deepEqual(selectScope(store.getState()), { kind: 'team', teamId: TEAM_A })

  actions.removeTeam(TEAM_A)
  assert.deepEqual(store.getState().buckets, {})
  assert.equal(selectScope(store.getState()), null)
})

test('a no-op action does not notify subscribers', () => {
  const { store, actions } = setup()
  let notified = 0

  store.subscribe(() => {
    notified += 1
  })
  actions.setDockOpen(false)
  actions.selectSession(null)
  actions.updateActiveTab((tab) => tab)
  assert.equal(notified, 0)
})
