import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkspaceTab } from '../../workspaceTabFactory.ts'

import { exposeDockBrowserTabs } from './dockBrowserTabs.ts'
import { dockMirror } from './dockMirror.ts'
import { createWorkspaceState } from './workspaceState.ts'

import type { TabBucket } from './workspaceState'
import type { WorkspaceTabState } from '../../workspaceTabState'

const TEAM = 'aaaaaaaaaaaaaaaaaaaaaaaa'

function pageTab(
  id: string,
  active: string,
  extra: Partial<WorkspaceTabState> = {},
): WorkspaceTabState {
  const tab = createWorkspaceTab(TEAM)
  const snapshot = {
    ...tab.navHistory[0],
    active,
    ...(extra.browserUrl ? { browserUrl: extra.browserUrl } : {}),
  }

  return {
    ...tab,
    id,
    active,
    navHistory: [snapshot],
    navHistoryIndex: 0,
    ...extra,
  } as WorkspaceTabState
}

const bucket = (tabs: WorkspaceTabState[], activeTabId: string): TabBucket => ({
  tabs,
  activeTabId,
  mountedTabIds: new Set(),
  dockOpen: true,
})

test("mirrors every page in the conversation's dock except New Tab, with the tab in front", () => {
  const state = createWorkspaceState({
    chat: bucket(
      [
        pageTab('b1', 'team.browser', {
          browserUrl: 'https://example.com/',
          restoredTitle: 'Example',
        }),
        pageTab('t1', 'team.terminal'),
        pageTab('n1', 'team.new-tab'),
      ],
      't1',
    ),
  })
  const mirror = dockMirror(state, 'chat', [])

  assert.deepEqual(
    mirror.tabs.map(({ id, kind, title, url }) => ({ id, kind, title, url })),
    [
      { id: 'b1', kind: 'team.browser', title: 'Example', url: 'https://example.com/' },
      { id: 't1', kind: 'team.terminal', title: 'Terminal', url: undefined },
    ],
  )
  assert.ok(mirror.tabs[1]?.href.startsWith(`/teams/${TEAM}/terminal`))
  assert.equal(mirror.activeTabId, 't1')
  assert.deepEqual(dockMirror(state, 'other', []), { tabs: [], activeTabId: null, recent: [] })
})

test("Recent is the Mac's dock history, most frecent first, with a browser page's address", () => {
  const now = Date.now()
  const history = [
    { href: `/teams/${TEAM}/runtimes`, title: 'Runtimes', count: 1, openedAt: now - 60_000 },
    {
      href: `/teams/${TEAM}/browser?url=${encodeURIComponent('http://localhost:3000/')}`,
      title: 'Browser',
      count: 5,
      openedAt: now,
    },
  ]

  assert.deepEqual(dockMirror(createWorkspaceState({}), 'chat', history, now).recent, [
    { href: history[1]?.href, title: 'Browser', url: 'http://localhost:3000/' },
    { href: `/teams/${TEAM}/runtimes`, title: 'Runtimes' },
  ])
})

test("the phone opens and closes pages only in this team and this conversation's dock", () => {
  const opened: [string, WorkspaceTabState][] = []
  const closed: string[] = []
  const state = createWorkspaceState({ chat: bucket([pageTab('t1', 'team.terminal')], 't1') })
  const globals = globalThis as unknown as { window?: Window }

  globals.window ??= {} as Window
  const unexpose = exposeDockBrowserTabs({
    userId: 'u1',
    getState: () => state,
    actions: {
      mountTab: () => {},
      closeTab: (id) => closed.push(id),
      openTabInSession: (session, tab) => opened.push([session, tab]),
    },
  })

  assert.equal(window.nuphosOpenDockTab?.('chat', TEAM, { href: '/teams/other-team/files' }), null)
  const id = window.nuphosOpenDockTab?.('chat', TEAM, { href: `/teams/${TEAM}/files` })

  assert.equal(opened[0]?.[0], 'chat')
  assert.equal(opened[0]?.[1].id, id)
  assert.equal(opened[0]?.[1].active, 'team.files')
  window.nuphosOpenDockTab?.('chat', TEAM, { page: 'team.plans' })
  assert.equal(opened[1]?.[1].active, 'team.plans')
  assert.equal(window.nuphosCloseDockTab?.('chat', 'not-here'), false)
  assert.equal(window.nuphosCloseDockTab?.('chat', 't1'), true)
  assert.deepEqual(closed, ['t1'])
  unexpose()
})
