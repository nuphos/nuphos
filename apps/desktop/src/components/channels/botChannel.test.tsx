import assert from 'node:assert/strict'

import { beforeEach, mock, test } from 'bun:test'

import type { AgentConversation } from '../../api'

const restored: string[] = []
const opened: string[] = []
const failures: unknown[] = []
let chats: AgentConversation[] = []

mock.module('../../api', () => ({
  api: {
    agentListConversations: () => Promise.resolve({ conversations: chats, nextCursor: null }),
    agentSetConversationArchived: (sessionId: string, archived: boolean) => {
      if (!archived) restored.push(sessionId)

      return Promise.resolve({ ok: true, archived, sessionIds: [sessionId] })
    },
    agentMakeBot: () => Promise.resolve({}),
  },
}))
mock.module('../ui/toast', () => ({
  toast: { apiError: (_title: string, error: unknown) => failures.push(error) },
}))
mock.module('../../app/workspace/openInApp', () => ({
  openInApp: (href: string) => opened.push(href),
}))

const { onChatArchived } = await import('../../lib/chatArchiveEvents')
const { makeBot, openBotChannel } = await import('./botChannel')

// The archive announcements travel as window events. Each test file runs in its own process.
Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })

const archivedChat = {
  sessionId: 'chat',
  kind: 'channel',
  title: '',
  faces: [{ id: 'bot', name: 'Bot', agent: {} }],
  createdAt: '2026-11-20T00:00:00Z',
  lastActiveAt: '2026-11-20T00:00:00Z',
  archivedAt: '2026-11-20T00:01:00Z',
} as unknown as AgentConversation

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  restored.length = 0
  opened.length = 0
  failures.length = 0
  chats = [archivedChat]
})

test('#4203: opening a Bot whose chats are all archived leaves it archived and drops its row', async () => {
  const archived: string[] = []
  const stop = onChatArchived((change) => archived.push(change.sessionId))
  const keys: string[] = []

  openBotChannel('team', 'bot', (key) => keys.push(key))
  await settle()
  stop()

  assert.deepEqual(restored, [])
  assert.deepEqual(keys, [])
  assert.deepEqual(archived, ['bot'])
})

test('making it a Bot again brings back the chat it had and opens it', async () => {
  await makeBot('team', 'bot')

  assert.deepEqual(failures, [])
  assert.deepEqual(restored, ['chat'])
  assert.equal(opened.length, 1)
  assert.match(opened[0] ?? '', /chat/)
})
