import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkspaceTab } from '../workspaceTabFactory.ts'

import { createWorkspaceState } from './store/workspaceState.ts'
import { createWorkspaceStore } from './store/workspaceStore.ts'
import { exposeDockBrowserTabs } from './store/dockBrowserTabs.ts'
import {
  browserViewId,
  isWatchedDockTab,
  paneLayout,
  registerBrowserView,
  setWatchedDockTab,
  watchedTabsOf,
} from './watchedDockTabs.ts'

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

test('one phone per tab: a second is refused, and the first keeps its watch', async () => {
  const tab = {
    ...createWorkspaceTab(TEAM),
    id: 'b1',
    active: 'team.browser',
    browserUrl: 'https://user.test/',
  }
  const store = createWorkspaceStore(
    createWorkspaceState({
      chat: { tabs: [tab], activeTabId: 'b1', mountedTabIds: new Set(), dockOpen: false },
    }),
  )
  const globals = globalThis as unknown as { window?: Window }

  globals.window ??= {} as Window
  const unexpose = exposeDockBrowserTabs({ getState: store.getState, actions: store.actions })
  const first = window.nuphosWatchDockTab?.('chat', 'b1', 390, 700)
  const unregister = registerBrowserView('b1', {
    getWebContentsId: () => 7,
  } as unknown as WebviewTag)

  assert.equal(await first, 7)
  assert.equal(await window.nuphosWatchDockTab?.('chat', 'b1', 390, 700), null)
  assert.equal(isWatchedDockTab('b1'), true)
  window.nuphosUnwatchDockTab?.('b1')
  assert.equal(isWatchedDockTab('b1'), false)
  unregister()
  unexpose()
})

test("a conversation's sidebar row knows which of its tabs a phone views", () => {
  setWatchedDockTab('t1', { width: 390, height: 700, sessionId: 'chat-a' })
  setWatchedDockTab('t2', { width: 390, height: 700, sessionId: 'chat-b' })
  assert.deepEqual(watchedTabsOf('chat-a'), ['t1'])
  assert.deepEqual(watchedTabsOf('chat-c'), [])
  setWatchedDockTab('t1', null)
  setWatchedDockTab('t2', null)
  assert.deepEqual(watchedTabsOf('chat-a'), [])
})

test('a watched tab off screen stays laid out invisibly; any other pane is as before', () => {
  const watch = { width: 390, height: 700, sessionId: 'chat' }

  assert.deepEqual(paneLayout(true, true, undefined), {
    className: 'h-full min-w-0 flex flex-col relative',
  })
  assert.deepEqual(paneLayout(false, true, undefined), { className: 'hidden' })
  // On the Mac's screen, a watched tab is left alone.
  assert.equal(paneLayout(true, true, watch).style, undefined)
  // Inactive, or in a closed dock: fixed at the phone's size, transparent.
  for (const [active, dockVisible] of [
    [false, true],
    [true, false],
  ] as const)
    assert.deepEqual(paneLayout(active, dockVisible, watch).style, {
      position: 'fixed',
      left: 0,
      top: 0,
      width: 390,
      height: 700,
      opacity: 0,
      pointerEvents: 'none',
    })
})
