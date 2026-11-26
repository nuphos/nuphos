import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { RuntimeInstance } from '../../types/runtime'

const rows = [
  {
    sessionId: 's-1',
    title: 'Release notes writer',
    avatar: '05-rembrandt',
    runtimeId: 'rt-1',
    activeRun: { streamId: 'x', startedAt: null },
  },
  { sessionId: 's-2', title: 'Dependency bump', runtimeId: 'rt-1' },
  { sessionId: 's-3', title: 'Elsewhere', runtimeId: 'rt-2' },
  { sessionId: 's-4', title: 'Team room', avatar: '01-a', kind: 'channel', runtimeId: 'rt-1' },
]

mock.module('../../components/sidebar/agentSessions', () => ({
  useAgentSessions: () => ({ data: rows }),
}))
// Stands in for the avatar: says whether it drew a face or only the runtime's icon.
mock.module('../../components/agent/AgentAvatar', () => ({
  AgentAvatar: ({ face }: { face: boolean }) => createElement('i', null, face ? 'face' : 'icon'),
}))

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

const { RuntimeSessionList } = await import('./RuntimeSessionList')
const { createRoot } = await import('react-dom/client')

test('lists this runtime’s Bots by face and its Tasks by runtime icon', async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const instance = { id: 'rt-1', provider: 'claude-code' } as RuntimeInstance

  await act(() => root.render(createElement(RuntimeSessionList, { teamId: 'team', instance })))
  const items = [...container.querySelectorAll('li')].map((li) => li.textContent)

  await act(() => root.unmount())
  assert.deepEqual(items, ['faceRelease notes writerBotRunning', 'iconDependency bumpTaskIdle'])
})
