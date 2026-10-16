import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  canOpenSessionDesktop,
  publishSessionDesktops,
  subscribeSessionDesktops,
} from '../../lib/sessionDesktops.ts'

import { openSessionDesktop } from './openSessionDesktop.ts'
import { selectBucket, createWorkspaceState } from './store/workspaceState.ts'
import { createWorkspaceStore } from './store/workspaceStore.ts'
import { syncDesktopTabs } from './syncDesktopTabs.ts'

test('a desktop tab appears in the session dock when the desktop opens and goes when it is torn down', () => {
  const store = createWorkspaceStore(createWorkspaceState())

  store.actions.retainTeams(['team-a'], 'team-a')
  publishSessionDesktops('chat', {
    teamId: 'team-a',
    desktops: [{ display: 3, title: 'Box 1 · :3' }],
  })
  syncDesktopTabs(store)
  const dock = selectBucket(store.getState(), 'chat')

  assert.equal(dock.dockOpen, true)
  assert.deepEqual(
    dock.tabs.map((tab) => [tab.id, tab.active, tab.filter]),
    [['desktop:chat:3', 'team.desktop', '3']],
  )
  // The same snapshot again changes nothing.
  syncDesktopTabs(store)
  assert.equal(selectBucket(store.getState(), 'chat').tabs.length, 1)
  publishSessionDesktops('chat', { teamId: 'team-a', desktops: [] })
  syncDesktopTabs(store)
  assert.equal(selectBucket(store.getState(), 'chat').tabs.length, 0)
  publishSessionDesktops('chat', null)
})

test('opening a desktop by hand claims one display, and a second click focuses its tab', async () => {
  const store = createWorkspaceStore(createWorkspaceState())
  const claims: string[] = []
  const request = (_team: string, sessionId: string) => {
    claims.push(sessionId)

    return Promise.resolve({ display: 4 })
  }
  const unsubscribe = subscribeSessionDesktops(() => syncDesktopTabs(store))

  store.actions.retainTeams(['team-a'], 'team-a')
  // A conversation whose agent has no desktop pool offers no entry.
  publishSessionDesktops('plain', { teamId: 'team-a', desktops: [] })
  assert.equal(canOpenSessionDesktop('plain'), false)
  publishSessionDesktops('chat', { teamId: 'team-a', desktops: [], canOpen: true })
  assert.equal(canOpenSessionDesktop('chat'), true)

  await openSessionDesktop('team-a', 'chat', request)
  assert.deepEqual(claims, ['chat'])
  assert.equal(selectBucket(store.getState(), 'chat').activeTabId, 'desktop:chat:4')

  // Another tab comes to the front; clicking again focuses the desktop without a claim.
  store.dispatch({
    type: 'openTab',
    sessionKey: 'chat',
    tab: { ...selectBucket(store.getState(), 'chat').tabs[0], id: 'other', active: 'team.files' },
  })
  await openSessionDesktop('team-a', 'chat', request)
  assert.deepEqual(claims, ['chat'])
  assert.equal(selectBucket(store.getState(), 'chat').activeTabId, 'desktop:chat:4')
  assert.equal(selectBucket(store.getState(), 'chat').tabs.length, 2)

  unsubscribe()
  publishSessionDesktops('chat', null)
  publishSessionDesktops('plain', null)
})
