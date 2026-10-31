import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkspaceTab } from '../workspaceTabFactory.ts'

import { createWorkspaceState } from './store/workspaceState.ts'
import { createWorkspaceStore } from './store/workspaceStore.ts'
import { browserViewId, registerBrowserView } from './watchedDockTabs.ts'

import type { WebviewTag } from 'electron'

const TEAM = 'aaaaaaaaaaaaaaaaaaaaaaaa'

test("mountTab mounts a conversation's tab without showing it", () => {
  const shown = { ...createWorkspaceTab(TEAM), id: 'shown' }
  const watched = { ...createWorkspaceTab(TEAM), id: 'watched' }
  const store = createWorkspaceStore(
    createWorkspaceState({
      chat: {
        tabs: [shown, watched],
        activeTabId: 'shown',
        mountedTabIds: new Set(),
        dockOpen: false,
      },
    }),
  )

  store.actions.mountTab('chat', 'watched')
  store.actions.mountTab('chat', 'not-a-tab')
  const bucket = store.getState().buckets.chat

  assert.deepEqual([...(bucket?.mountedTabIds ?? [])].sort(), ['shown', 'watched'])
  assert.equal(bucket?.activeTabId, 'shown')
  assert.equal(bucket?.dockOpen, false)
})

test("a watched tab's page id arrives once its view attaches, or null in time", async () => {
  const waiting = browserViewId('tab-1', 1000)
  const unregister = registerBrowserView('tab-1', {
    getWebContentsId: () => 42,
  } as unknown as WebviewTag)

  assert.equal(await waiting, 42)
  assert.equal(await browserViewId('tab-1', 10), 42)
  unregister()
  assert.equal(await browserViewId('tab-1', 10), null)
})
