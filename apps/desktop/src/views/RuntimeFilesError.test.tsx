import assert from 'node:assert/strict'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import { queryKeys } from '../lib/query/keys'

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

// #4301 and #4304: the button said "Open conversation"; it names the Task the file came from.
test('a file Files cannot load offers to open its Task', async () => {
  const opened: string[] = []
  const client = new QueryClient()
  const container = dom.document.createElement('div')

  client.setQueryData(queryKeys.agentSessions('team'), [
    { sessionId: 'task-1', title: 'Weekly metrics' },
  ])
  dom.document.body.append(container)
  await act(async () => {
    createRoot(container as unknown as HTMLElement).render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(RuntimeFilesError, {
          teamId: 'team',
          error: 'File not found',
          filePath: '/workspace/report.md',
          source: { label: 'Runtime', sessionId: 'task-1' },
          onRetry: () => undefined,
          onOpenConversation: (sessionId: string) => opened.push(sessionId),
        }),
      ),
    )
  })
  const open = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Weekly metrics',
  )

  assert.ok(open, 'the button names the Task')
  await act(async () => open.click())
  assert.deepEqual(opened, ['task-1'])
})

// A Bot's one-to-one channel is a chat, not the Bot's own session row.
test('a file linked in a Bot chat names the Bot', async () => {
  const client = new QueryClient()
  const container = dom.document.createElement('div')

  client.setQueryData(queryKeys.agentSessions('team'), [
    {
      sessionId: 'bot-chat',
      kind: 'channel',
      faces: [{ id: 'bot', name: 'Metrics Bot', agent: { avatar: '07-ada' } }],
    },
  ])
  dom.document.body.append(container)
  await act(async () => {
    createRoot(container as unknown as HTMLElement).render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(RuntimeFilesError, {
          teamId: 'team',
          error: 'File not found',
          filePath: '/workspace/report.md',
          source: { label: 'Runtime', sessionId: 'bot-chat' },
          onRetry: () => undefined,
          onOpenConversation: () => undefined,
        }),
      ),
    )
  })
  assert.ok([...container.querySelectorAll('button')].some((b) => b.textContent === 'Metrics Bot'))
})

test('a source chat the sidebar has not listed reads Open', async () => {
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
          source: { label: 'Runtime', sessionId: 'task-archived' },
          onRetry: () => undefined,
          onOpenConversation: () => undefined,
        }),
      ),
    )
  })
  assert.ok([...container.querySelectorAll('button')].some((b) => b.textContent === 'Open'))
})
