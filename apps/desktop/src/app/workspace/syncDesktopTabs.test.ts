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

const holding = (displays: number[], canOpen = true) =>
  publishSessionDesktops('chat', {
    teamId: 'team-a',
    desktops: displays.map((display) => ({ display, title: `Box 1 · :${String(display)}` })),
    canOpen,
  })

function desktopDock() {
  const store = createWorkspaceStore(createWorkspaceState())
  const unsubscribe = subscribeSessionDesktops(() => syncDesktopTabs(store))

  store.actions.retainTeams(['team-a'], 'team-a')

  return {
    store,
    tabs: () => selectBucket(store.getState(), 'chat').tabs.map((tab) => tab.id),
    done: () => {
      unsubscribe()
      publishSessionDesktops('chat', null)
    },
  }
}

const noClaim = () => Promise.reject(new Error('no claim expected'))

test('a desktop the agent holds opens no tab by itself', () => {
  const { store, tabs, done } = desktopDock()

  holding([3])
  syncDesktopTabs(store)
  // The chat leaves the screen and comes back: opened without its runtime state
  // first, then the catch-up poll brings the desktop back.
  publishSessionDesktops('chat', null)
  holding([], false)
  holding([3])
  // A second desktop, and a turn's frame that briefly carries none.
  holding([3, 5])
  holding([])
  holding([3, 5])
  assert.deepEqual(tabs(), [])
  done()
})

test('a desktop opens its tab once the user asks, and the tab goes when it is torn down', async () => {
  const { store, tabs, done } = desktopDock()

  holding([3])
  await openSessionDesktop('team-a', 'chat', noClaim)
  const dock = selectBucket(store.getState(), 'chat')

  assert.equal(dock.dockOpen, true)
  assert.equal(dock.activeTabId, 'desktop:chat:3')
  assert.deepEqual(
    dock.tabs.map((tab) => [tab.id, tab.active, tab.filter]),
    [['desktop:chat:3', 'team.desktop', '3']],
  )
  // New snapshots of the same desktop change nothing; closing it keeps it closed.
  holding([3, 5])
  assert.deepEqual(tabs(), ['desktop:chat:3'])
  store.actions.closeTab('desktop:chat:3')
  holding([3])
  assert.deepEqual(tabs(), [])
  await openSessionDesktop('team-a', 'chat', noClaim)
  assert.deepEqual(tabs(), ['desktop:chat:3'])
  holding([])
  assert.deepEqual(tabs(), [])
  done()
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
