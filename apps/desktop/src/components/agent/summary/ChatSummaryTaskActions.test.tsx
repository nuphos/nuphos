import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentConversation } from '../../../api/agent-types'

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

const { ChatSummaryTaskActions } = await import('./ChatSummaryTaskActions')
const { createRoot } = await import('react-dom/client')

async function archiveShown(conversation: Partial<AgentConversation>) {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  try {
    await act(() =>
      root.render(
        createElement(ChatSummaryTaskActions, {
          conversation: { sessionId: 's-1', ...conversation } as AgentConversation,
          teamId: 't-1',
        }),
      ),
    )

    return [...container.querySelectorAll('button')].some(
      (button) => button.textContent === 'Archive',
    )
  } finally {
    await act(() => root.unmount())
    container.remove()
  }
}

test("a participant who is not the owner gets Archive on a teammate's Task", async () => {
  assert.equal(await archiveShown({ isOwner: false, canManage: false, canArchive: true }), true)
})

test('the server refusing archive hides it, and the owner keeps it', async () => {
  assert.equal(await archiveShown({ isOwner: false, canManage: false, canArchive: false }), false)
  assert.equal(await archiveShown({ isOwner: true, canManage: true, canArchive: true }), true)
})
