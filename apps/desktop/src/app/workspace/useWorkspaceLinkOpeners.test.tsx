import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'

const TEAM = '0123456789abcdef01234567'

/** One pane's link opener with Settings open over it, as the Computers page sees it. */
async function paneUnderSettings(run: (pane: Awaited<ReturnType<typeof mountPane>>) => unknown) {
  const { Window } = await import('happy-dom')
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    CustomEvent: dom.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const pane = await mountPane(dom.document.createElement('div') as unknown as HTMLElement)

  try {
    await run(pane)
  } finally {
    await pane.unmount()
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

async function mountPane(container: HTMLElement) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { listenOpenInApp } = await import('./openInApp')
  const { createWorkspaceState, selectAllResidentTabs } = await import('./store/workspaceState')
  const { createWorkspaceStore } = await import('./store/workspaceStore')
  const { useWorkspaceLinkOpeners } = await import('./useWorkspaceLinkOpeners')
  const { WorkspacePaneContext } = await import('./WorkspacePaneContext')
  const store = createWorkspaceStore({ ...createWorkspaceState(), teamsKnown: true })
  const state = { settingsOpen: true, sections: [] as string[], conversations: [] as string[] }
  const openers = new Map<string, (href: string) => unknown>()
  const hook: { current?: ReturnType<typeof useWorkspaceLinkOpeners> } = {}
  const Pane = () => {
    hook.current = useWorkspaceLinkOpeners({
      accountsByTeam: {},
      workspaceStore: store,
      workspaceActions: store.actions,
      teams: [{ id: TEAM }],
      openConversationInNewTab: (sessionId: string) => {
        state.conversations.push(sessionId)
      },
      openSettingsSection: (section: string) => {
        state.sections.push(section)
      },
      setSettingsOpen: (open: boolean) => {
        state.settingsOpen = open
      },
    } as never)

    return null
  }
  const context = {
    paneId: 'a',
    registerLinkOpener: (id: string, open: (href: string) => unknown) => {
      openers.set(id, open)

      return () => openers.delete(id)
    },
  }
  const root = createRoot(container)
  const stop = listenOpenInApp(openers, 'a')

  await act(() =>
    root.render(
      createElement(
        WorkspacePaneContext.Provider,
        { value: context as never },
        createElement(Pane),
      ),
    ),
  )

  return {
    state,
    store,
    hook,
    tabs: (page: string) =>
      selectAllResidentTabs(store.getState()).filter((tab) => tab.active === page),
    unmount: async () => {
      stop()
      await act(() => root.unmount())
    },
  }
}

// #2947: Computers sits in Settings, which covers the workspace while it is open.
test('Open desktop on another computer, from Settings, shows the desktop it opens', async () => {
  const { openComputerScreen } = await import('../../views/settings/boxDesktop')

  await paneUnderSettings(({ state, tabs }) => {
    // What the Computers row's Open desktop does once the computer has handed over its screen.
    openComputerScreen('device-1', TEAM, 'runtime/r1', 0)

    assert.equal(tabs('team.desktop').length, 1)
    assert.equal(state.settingsOpen, false, 'Settings still covers the desktop it opened')
  })
})

test('a link to a page that lives in Settings keeps Settings open on that page', async () => {
  const { openInApp } = await import('./openInApp')

  await paneUnderSettings(({ state }) => {
    openInApp(`/teams/${TEAM}/agents`)

    assert.deepEqual(state.sections, ['workspace.computers'])
    assert.equal(state.settingsOpen, true)
  })
})

test('a Connectors link opens its dialog in view, as Archived opens its chat', async () => {
  const { openInApp } = await import('./openInApp')

  await paneUnderSettings(({ state, store }) => {
    openInApp(`/teams/${TEAM}/connectors`)

    assert.ok(store.getState().connectorsDialog)
    assert.equal(state.settingsOpen, false)
  })
})

test('opening a conversation from inside Settings opens it in view, as Archived does', async () => {
  const { openInApp } = await import('./openInApp')
  const sessionId = '11111111-2222-4333-8444-555555555555'

  await paneUnderSettings(({ state }) => {
    openInApp(`/teams/${TEAM}/agent/${sessionId}`)

    assert.deepEqual(state.conversations, [sessionId])
    assert.equal(state.settingsOpen, false)
  })
})

// #4505: reopening that chat from its own team would take the app back to the page's team.
test("a page of another team opens on a new chat in that team, not in the chat's dock", async () => {
  const { openInApp } = await import('./openInApp')
  const { selectBucket, selectScope, sessionKeyOf } = await import('./store/workspaceState')
  const other = '0123456789abcdef01234568'
  const sessionId = '11111111-2222-4333-8444-555555555555'

  await paneUnderSettings(({ store }) => {
    store.actions.selectSession(sessionId, { teamId: TEAM })
    openInApp(`/teams/${other}/dashboards`)

    const state = store.getState()

    assert.equal(state.sessionId, null)
    assert.equal(selectScope(state)?.teamId, other)
    assert.deepEqual(selectBucket(state, sessionKeyOf(sessionId)).tabs, [])
  })
})

// #4558: a nuphos://open link to a team, as a web page opens the app with.
test("a link to another team goes to that team on a new chat, not in the chat's dock", async () => {
  const { selectBucket, selectScope, sessionKeyOf } = await import('./store/workspaceState')
  const other = '0123456789abcdef01234568'
  const sessionId = '11111111-2222-4333-8444-555555555555'

  await paneUnderSettings(({ store, hook }) => {
    store.actions.selectSession(sessionId, { teamId: TEAM })
    hook.current?.openAppOpenDeepLink({ path: `/teams/${other}`, url: '' } as never)
    const state = store.getState()

    assert.equal(state.sessionId, null)
    assert.equal(selectScope(state)?.teamId, other)
    assert.deepEqual(selectBucket(state, sessionKeyOf(sessionId)).tabs, [])
  })
})

// #4558: only a bare team link stops at the team; a page of the team on screen still opens.
test('a link to a page of the team on screen opens that page beside the open chat', async () => {
  const { pageLocationForTab } = await import('../../app/workspaceTabFactory')
  const { selectBucket, selectScope, sessionKeyOf } = await import('./store/workspaceState')
  const sessionId = '11111111-2222-4333-8444-555555555555'

  await paneUnderSettings(({ store, hook }) => {
    store.actions.selectSession(sessionId, { teamId: TEAM })
    hook.current?.openAppOpenDeepLink({ path: `/teams/${TEAM}/dashboards`, url: '' } as never)
    const state = store.getState()
    const bucket = selectBucket(state, sessionKeyOf(sessionId))

    assert.equal(state.sessionId, sessionId)
    assert.equal(selectScope(state)?.teamId, TEAM)
    assert.deepEqual(
      bucket.tabs.map((tab) => [tab.id === bucket.activeTabId, pageLocationForTab(tab).pathname]),
      [[true, `/teams/${TEAM}/dashboards`]],
    )
  })
})
