import assert from 'node:assert/strict'
import { test } from 'node:test'

import { publishSessionDesktops } from '../../lib/sessionDesktops.ts'

import { selectBucket, createWorkspaceState } from './store/workspaceState.ts'
import { createWorkspaceStore } from './store/workspaceStore.ts'
import { syncDesktopTabs } from './syncDesktopTabs.ts'

test('a desktop tab appears in the session dock when the desktop opens and goes when it is torn down', () => {
  const store = createWorkspaceStore(createWorkspaceState())

  store.actions.retainTeams(['team-a'], 'team-a')
  publishSessionDesktops('chat', { teamId: 'team-a', displays: [3] })
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
  publishSessionDesktops('chat', { teamId: 'team-a', displays: [] })
  syncDesktopTabs(store)
  assert.equal(selectBucket(store.getState(), 'chat').tabs.length, 0)
  publishSessionDesktops('chat', null)
})
