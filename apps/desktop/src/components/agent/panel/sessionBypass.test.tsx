import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'

import type { AgentConversation } from '../../../api'

const saves: unknown[][] = []

mock.module('../../../api', () => ({
  api: {
    agentSetAutoModeBypass: (...args: unknown[]) => {
      saves.push(args)

      return Promise.resolve({ bypass: args[1] })
    },
  },
}))
mock.module('../../../lib/analytics', () => ({ track: () => {} }))

const dom = new Window()
const written: string[] = []
// The app's modules read browser globals as they load; the store records any default written.
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  localStorage: { getItem: () => null, setItem: (key: string) => written.push(key) },
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { queryClient } = await import('../../../lib/query/client')
const { queryKeys } = await import('../../../lib/query/keys')
const { remembersDefaultMode, saveBypass } = await import('./sessionBypass')

const row = (fields: Partial<AgentConversation> & { sessionId: string }): AgentConversation => ({
  title: '',
  firstMessage: '',
  messageCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActiveAt: '2026-01-01T00:00:00.000Z',
  ...fields,
})

test("a Task's permission mode becomes the default for new chats; a Bot's stays its own", () => {
  queryClient.setQueryData<AgentConversation[]>(queryKeys.agentSessions('team'), [
    row({ sessionId: 'task' }),
    row({ sessionId: 'bot', avatar: '07-ada' }),
  ])
  assert.equal(remembersDefaultMode('team', 'task'), true)
  assert.equal(remembersDefaultMode('team', 'bot'), false)
  queryClient.clear()
})

test('saving a permission mode leaves the default for new chats to the caller', async () => {
  let saved = 0

  saveBypass('bot', true, { saved: () => saved++, failed: () => assert.fail('not refused') })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(saves, [['bot', true]])
  assert.equal(saved, 1)
  assert.deepEqual(written, [], 'nothing remembered for new chats')
})
