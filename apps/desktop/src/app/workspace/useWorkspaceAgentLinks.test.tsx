import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'

import type { AgentChatDeepLinkPayload } from '../../api'
import type { AgentPromptSeed } from '../../app/workspaceTabState'

const TEAM = '0123456789abcdef01234567'

// #3012: a deep link that opens a new task with a prompt, arriving while the
// sidebar is on the Bots page, left the prompt behind the New Bot screen.
test('a chat deep link switches the sidebar to Tasks, where its prompt sends', async () => {
  const { Window } = await import('happy-dom')
  const dom = new Window()
  let deepLink: ((payload: AgentChatDeepLinkPayload) => void) | undefined
  const api = new Proxy(
    {},
    {
      get: (_target, name: string) =>
        name === 'onAgentChatDeepLink'
          ? (cb: (payload: AgentChatDeepLinkPayload) => void) => {
              deepLink = cb

              return () => {}
            }
          : name.startsWith('on')
            ? () => () => {}
            : () => new Promise(() => {}),
    },
  )

  Object.assign(dom, { api })
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
  const { useWorkspaceAgentLinks } = await import('./useWorkspaceAgentLinks')
  const store = createWorkspaceStore({
    ...createWorkspaceState(),
    teamsKnown: true,
    teamScope: { kind: 'team', teamId: TEAM },
  })
  const queue: AgentPromptSeed[] = []
  const Pane = () => {
    useWorkspaceAgentLinks({
      user: { id: 'u1' },
      workspaceStore: store,
      workspaceActions: store.actions,
      chatPromptNonceRef: { current: 0 },
      enqueueChatPrompt: (seed: AgentPromptSeed) => queue.push(seed),
    } as never)

    return null
  }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)

  try {
    setSidebarMode(TEAM, 0)
    await act(async () => {
      root.render(createElement(Pane))
    })
    await act(async () => {
      deepLink?.({ prompt: 'Look at this log.', autoSend: true } as AgentChatDeepLinkPayload)
    })

    assert.equal(sidebarMode(TEAM, 0), 1)
    assert.deepEqual(
      queue.map((seed) => [seed.text, seed.newChat]),
      [['Look at this log.', true]],
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
