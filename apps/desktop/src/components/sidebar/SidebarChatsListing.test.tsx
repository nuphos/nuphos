import assert from 'node:assert/strict'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { Item } from './types'

// The listing as TanStack Query reports it; each test sets the state it needs.
let listing: { data?: unknown[]; isPending: boolean; isError: boolean }

mock.module('../../api', () => ({ api: {} }))
mock.module('../ui/toast', () => ({ toast: {} }))
mock.module('./agentSessions', () => ({
  useAgentSessions: () => listing,
  removeChat: async () => {},
  retitleChat: async () => {},
}))
mock.module('./use-chat-items', () => ({ useChatItems: () => [] }))
mock.module('./use-sidebar-archive-events', () => ({
  useSidebarArchiveEvents: () => ({ offerUndo: () => {} }),
}))
mock.module('./useBotArchiveFocus', () => ({ useBotArchiveFocus: () => () => {} }))

async function chatItems(): Promise<Item[] | undefined> {
  const dom = new Window()
  const values = {
    window: dom,
    navigator: dom.navigator,
    document: dom.document,
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { useSidebarChats } = await import('./use-sidebar-data')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  let items: Item[] | undefined
  const Probe = () => {
    items = useSidebarChats({ teamId: 't', agentSessionId: null, chatShown: false }).chatItems

    return null
  }

  try {
    await act(() =>
      root.render(
        createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Probe)),
      ),
    )

    return items
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

test('no chat rows, not an empty list, before the first listing arrives', async () => {
  listing = { isPending: true, isError: false }
  assert.equal(await chatItems(), undefined)
})

// The listing polls again, so a failed first one is still loading, never "No Bots yet".
test('no chat rows, not an empty list, when the first listing failed', async () => {
  listing = { isPending: false, isError: true }
  assert.equal(await chatItems(), undefined)
})

test('an empty list once a listing arrived empty', async () => {
  listing = { data: [], isPending: false, isError: false }
  assert.deepEqual(await chatItems(), [])
})
