import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import { publishRuntimeStates } from '../../lib/agentRuntimeStates'

import type { RuntimeExecution } from '../../lib/runtimeExecution'

let listings = 0
// The Bot's state each listing reports, as the session list publishes it.
let state: RuntimeExecution['state'] = 'active'

mock.module('../../api.ts', () => ({
  api: {
    agentListConversations: async (_teamId: string, options: { scope: string; kind?: string }) => {
      // A listing reads four pages; count it once.
      if (options.scope === 'mine' && !options.kind) listings++
      publishRuntimeStates([['bot', { state, channelIds: ['chat'] }]])

      return {
        conversations: [{ sessionId: 'bot', title: 'Bot', lastActiveAt: '2026-11-18T00:00:00Z' }],
      }
    },
  },
}))

// In short steps: React renders what the listings bring only as each `act` ends.
async function wait(ms: number) {
  for (let left = ms; left > 0; left -= 100)
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
}

test('the session list is read every second while the Bot works, and every 4 s again after', async () => {
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

  const client = new QueryClient()

  try {
    await act(() =>
      root.render(createElement(QueryClientProvider, { client }, createElement(Probe))),
    )
    await wait(2_500)
    assert.ok(listings >= 3, `a listing about every second while the Bot works, got ${listings}`)
    state = 'idle'
    await wait(1_200)
    const after = listings

    await wait(2_500)
    assert.equal(listings, after, 'no fast listing once the Bot rests')
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}, 15_000)
