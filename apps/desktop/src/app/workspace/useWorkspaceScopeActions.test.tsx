import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'

import type { AgentPromptSeed } from '../../app/workspaceTabState'

const TEAM = '0123456789abcdef01234567'

// #3012: "Set up in a task" opens a new task with its prompt; from the Bots page
// (the default) that task's composer was hidden, so the setup never sent.
test('a chat opened with a prompt switches the sidebar to Tasks, where it sends', async () => {
  const { Window } = await import('happy-dom')
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    location: dom.location,
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { setSidebarMode, sidebarMode } = await import('../../components/sidebar/sidebarModeStore')
  const { createWorkspaceState } = await import('./store/workspaceState')
  const { createWorkspaceStore } = await import('./store/workspaceStore')
  const { useWorkspaceScopeActions } = await import('./useWorkspaceScopeActions')
  const store = createWorkspaceStore({
    ...createWorkspaceState(),
    teamsKnown: true,
    teamScope: { kind: 'team', teamId: TEAM },
  })
  let queue: AgentPromptSeed[] = []
  let open: ((prompt: string) => void) | undefined
  const Pane = () => {
    open = useWorkspaceScopeActions({
      workspaceStore: store,
      workspaceActions: store.actions,
      setAgentSidebarPendingImport: () => {},
      setWorkspaceDockExpanded: () => {},
      chatPromptNonceRef: { current: 0 },
      setPendingChatPromptQueue: (next: (prev: AgentPromptSeed[]) => AgentPromptSeed[]) => {
        queue = next(queue)
      },
      updateTab: () => {},
    } as never).openAgentChatWithPrompt

    return null
  }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)

  try {
    setSidebarMode(TEAM, 0)
    await act(async () => {
      root.render(createElement(Pane))
    })
    await act(async () => {
      open?.('Set up the Google Cloud connector.')
    })

    assert.equal(sidebarMode(TEAM, 0), 1)
    assert.deepEqual(
      queue.map((seed) => [seed.text, seed.autoSend, seed.newChat]),
      [['Set up the Google Cloud connector.', true, true]],
    )
  } finally {
    await act(async () => {
      root.unmount()
    })
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
