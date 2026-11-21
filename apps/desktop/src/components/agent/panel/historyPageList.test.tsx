import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, createRef } from 'react'

import type { AgentConversation } from '../../../api'

const dom = new Window()
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { HistoryPageList } = await import('./historyPageList')
const { createRoot } = await import('react-dom/client')

async function archiveShown(conversation: Partial<AgentConversation>) {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  try {
    await act(() =>
      root.render(
        createElement(HistoryPageList, {
          items: [
            {
              sessionId: 's-1',
              title: 'Release checklist',
              ...conversation,
            } as AgentConversation,
          ],
          loading: false,
          debouncedQuery: '',
          ownerId: null,
          historyScope: 'team',
          teamId: 't-1',
          openingSessionId: null,
          selectedSessionId: null,
          layout: 'page',
          selectedRowRef: createRef<HTMLDivElement>(),
          hasMore: false,
          sentinelRef: createRef<HTMLDivElement>(),
          loadingMore: false,
          loadMore: () => Promise.resolve(),
          onOpenConversation: () => null,
          onArchive: () => Promise.resolve(),
        }),
      ),
    )

    return container.querySelector('button[aria-label="Archive Task"]') !== null
  } finally {
    await act(() => root.unmount())
    container.remove()
  }
}

test("a participant who is not the owner gets Archive on a teammate's Task in the team list", async () => {
  assert.equal(await archiveShown({ isOwner: false, canManage: false, canArchive: true }), true)
})

test('the server refusing archive hides it in the team list', async () => {
  assert.equal(await archiveShown({ isOwner: false, canManage: false, canArchive: false }), false)
})
