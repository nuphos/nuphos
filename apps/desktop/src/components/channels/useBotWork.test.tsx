import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import { publishRuntimeStates } from '../../lib/agentRuntimeStates'

import type { RuntimeExecution } from '../../lib/runtimeExecution'

let listings = 0
// The Bot's state each listing reports, as the session list publishes it.
let state: RuntimeExecution['state'] = 'active'
// The turn the Bot chat follows, ended by the test; and the turns it stopped following.
let endTurn = () => {}
let stopped: string[] = []

mock.module('../../api.ts', () => ({
  api: {
    agentListConversations: async (_teamId: string, options: { scope: string; kind?: string }) => {
      // A listing reads four pages; count it once.
      if (options.scope === 'mine' && !options.kind) listings++
      publishRuntimeStates([['bot', { state, channelIds: ['chat'] }]])

      return {
        conversations: [
          {
            sessionId: 'bot',
            title: 'Bot',
            lastActiveAt: '2026-11-18T00:00:00Z',
            activeRun: state === 'active' ? { streamId: 's', startedAt: null } : null,
          },
        ],
      }
    },
  },
}))

// In short steps: React renders what the listings bring only as each `act` ends.
async function wait(ms: number) {
  for (let left = ms; left > 0; left -= 100)
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
}

/** Shows a Bot chat's header for `during`, and returns its listings. */
async function listingsWhile(during: () => Promise<void>) {
  const dom = new Window()
  const values = {
    window: dom,
    navigator: dom.navigator,
    document: dom.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  Object.assign(dom, {
    api: {
      agentWaitForRunEnd: () =>
        new Promise<void>((resolve) => {
          endTurn = resolve
        }),
      agentStopWaitingForRunEnd: async (streamId: string) => {
        stopped.push(streamId)
      },
    },
  })
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  // After the window: the query library decides at import whether it runs on a server, without timers.
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { useBotWork } = await import('./useBotWork')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  const Probe = () => {
    useBotWork('team', 'bot', 'chat')

    return null
  }

  listings = 0
  stopped = []
  try {
    await act(() =>
      root.render(
        createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Probe)),
      ),
    )
    await during()
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

test("the end of the Bot's turn lists again at once, and nothing polls faster meanwhile", async () => {
  state = 'active'
  await listingsWhile(async () => {
    await wait(2_500)
    assert.equal(listings, 1, 'no fast listing while the Bot works')
    state = 'idle'
    await act(async () => endTurn())
    await wait(300)
    assert.equal(listings, 2, 'the turn ending lists again')
  })
}, 15_000)

test('leaving the Bot chat stops following its turn', async () => {
  state = 'active'
  await listingsWhile(async () => {
    await wait(300)
  })
  assert.deepEqual(stopped, ['s'])
}, 15_000)
