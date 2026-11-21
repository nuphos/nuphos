import assert from 'node:assert/strict'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

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

const { createRoot } = await import('react-dom/client')
const { RuntimeFilesError } = await import('./RuntimeFilesError')

// #4301: the button said "Open conversation"; it opens the Task the file came from.
test('a file Files cannot load offers to open its Task', async () => {
  const opened: string[] = []
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  await act(async () => {
    createRoot(container as unknown as HTMLElement).render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(RuntimeFilesError, {
          teamId: 'team',
          error: 'File not found',
          filePath: '/workspace/report.md',
          source: { conversationTitle: 'Weekly metrics', label: 'Runtime', sessionId: 'task-1' },
          onRetry: () => undefined,
          onOpenConversation: (sessionId: string) => opened.push(sessionId),
        }),
      ),
    )
  })
  const open = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Open Task')

  assert.ok(open, 'the button reads Open Task')
  await act(async () => open.click())
  assert.deepEqual(opened, ['task-1'])
})
