import assert from 'node:assert/strict'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { Tab } from './model'

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
// Nothing here waits on the backend: every bridge call stays pending.
Object.defineProperty(dom, 'api', {
  value: new Proxy({}, { get: () => () => new Promise(() => {}) }),
})
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

const { RetainedConversations } = await import('./Conversation')
const { createRoot } = await import('react-dom/client')

const chat = (id: string): Tab =>
  ({
    id,
    sessionId: id,
    title: id,
    messages: [
      {
        id: `${id}-answer`,
        role: 'assistant',
        createdAt: 1,
        parts: [{ type: 'text', text: `Answer in ${id}` }],
      },
    ],
    streaming: false,
    connected: false,
    streamId: null,
    streamStartedAt: null,
    error: null,
    autoResumeAttempts: 0,
    credentialAccess: { mode: 'all' },
  }) as unknown as Tab

test('switching back to a kept chat shows the same view instead of building a new one', async () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  const client = new QueryClient()
  const tabs = [chat('a'), chat('b')]
  const show = (shown: Tab) =>
    act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(RetainedConversations, {
            tabs,
            shown,
            visible: true,
            teamId: 'team',
            onLoadEarlier: () => {},
          }),
        ),
      ),
    )
  const answer = (id: string) =>
    [...host.querySelectorAll('*')].find((el) => el.textContent === `Answer in ${id}`)

  document.body.append(host)
  await show(tabs[0])
  const first = answer('a')

  assert.ok(first)
  await show(tabs[1])
  await show(tabs[0])
  assert.equal(answer('a'), first)
  assert.ok(first.isConnected)
  await act(async () => root.unmount())
  host.remove()
})
