import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'

import type { AgentChatDeepLinkPayload } from '../../api'
import type { AgentPromptSeed } from '../../app/workspaceTabState'

const TEAM = '0123456789abcdef01234567'

/** The pane's deep-link handler over `store`, with the prompts it queued. */
async function withDeepLink(
  run: (args: {
    deepLink: (payload: AgentChatDeepLinkPayload) => Promise<void>
    store: Awaited<ReturnType<typeof makeStore>>
    queue: AgentPromptSeed[]
  }) => Promise<void>,
) {
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
  const { useWorkspaceAgentLinks } = await import('./useWorkspaceAgentLinks')
  const store = await makeStore()
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
    await act(async () => {
      root.render(createElement(Pane))
    })
    await run({
      deepLink: (payload) =>
        act(async () => {
          deepLink?.(payload)
        }),
      store,
      queue,
    })
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
}

async function makeStore() {
  const { createWorkspaceState } = await import('./store/workspaceState')
  const { createWorkspaceStore } = await import('./store/workspaceStore')

  return createWorkspaceStore({
    ...createWorkspaceState(),
    teamsKnown: true,
    teamScope: { kind: 'team', teamId: TEAM },
  })
}

// #3012: a deep link that opens a new task with a prompt, arriving while the
// sidebar is on the Bots page, left the prompt behind the New Bot screen.
test('a chat deep link switches the sidebar to Tasks, where its prompt sends', async () => {
  const { setSidebarMode, sidebarMode } = await import('../../components/sidebar/sidebarModeStore')

  await withDeepLink(async ({ deepLink, queue }) => {
    setSidebarMode(TEAM, 0)
    await deepLink({ prompt: 'Look at this log.', autoSend: true } as AgentChatDeepLinkPayload)

    assert.equal(sidebarMode(TEAM, 0), 1)
    assert.deepEqual(
      queue.map((seed) => [seed.text, seed.newChat]),
      [['Look at this log.', true]],
    )
  })
})

// #4558: reopening that chat from its own team would take the app back to the link's team.
test("a chat deep link into another team goes there on a new chat, not in the chat's dock", async () => {
  const { selectBucket, selectScope, sessionKeyOf } = await import('./store/workspaceState')
  const other = '0123456789abcdef01234568'
  const sessionId = '11111111-2222-4333-8444-555555555555'

  await withDeepLink(async ({ deepLink, store }) => {
    store.actions.selectSession(sessionId, { teamId: TEAM })
    await deepLink({ prompt: 'Look.', teamId: other } as AgentChatDeepLinkPayload)
    const state = store.getState()

    assert.equal(state.sessionId, null)
    assert.equal(selectScope(state)?.teamId, other)
    assert.deepEqual(selectBucket(state, sessionKeyOf(sessionId)).tabs, [])
  })
})

// #4558: a chat link into the team on screen still opens its new chat with the prompt there.
test('a chat deep link into the team on screen opens its new chat there', async () => {
  const { selectScope } = await import('./store/workspaceState')

  await withDeepLink(async ({ deepLink, store, queue }) => {
    await deepLink({ prompt: 'Look.', teamId: TEAM } as AgentChatDeepLinkPayload)

    assert.equal(selectScope(store.getState())?.teamId, TEAM)
    assert.deepEqual(
      queue.map((seed) => [seed.text, seed.newChat]),
      [['Look.', true]],
    )
  })
})
