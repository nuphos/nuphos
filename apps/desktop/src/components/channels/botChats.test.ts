import assert from 'node:assert/strict'
import test from 'node:test'

import { botOfChannel, chooseBotChat, openBotChats, readBotChats } from './botChats.ts'

import type { AgentConversation, AgentConversationsPage } from '../../api/agent-types.ts'

const chat = (
  sessionId: string,
  botId: string,
  lastActiveAt: string,
  archivedAt?: string,
): AgentConversation =>
  ({
    sessionId,
    kind: 'channel',
    title: sessionId,
    faces: [{ id: botId, name: botId, agent: {} }],
    createdAt: lastActiveAt,
    lastActiveAt,
    ...(archivedAt ? { archivedAt } : {}),
  }) as AgentConversation

const page = (conversations: AgentConversation[], nextCursor: string | null = null) =>
  ({ conversations, nextCursor, hasMore: Boolean(nextCursor) }) as AgentConversationsPage

test("a Bot's chats are read across pages, its own only, newest first", async () => {
  const pages: Record<string, AgentConversationsPage> = {
    first: page(
      [chat('a', 'bot', '2026-11-01T00:00:00Z'), chat('x', 'other', '2026-11-05T00:00:00Z')],
      'p2',
    ),
    p2: page([chat('b', 'bot', '2026-11-03T00:00:00Z', '2026-11-04T00:00:00Z')]),
  }
  const chats = await readBotChats(async (cursor) => pages[cursor ?? 'first'] ?? page([]), 'bot')

  assert.deepEqual(
    chats.map((c) => c.sessionId),
    ['b', 'a'],
  )
})

test('a Bot with an open chat opens it, archived ones or not', () => {
  const chats = [
    chat('archived', 'bot', '2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z'),
    chat('open', 'bot', '2026-11-01T00:00:00Z'),
  ]

  assert.deepEqual(chooseBotChat(chats), { chatId: 'open', archived: false })
})

test('a Bot whose chats are all archived brings back the latest, rather than making one', () => {
  const chats = [
    chat('latest', 'bot', '2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z'),
    chat('older', 'bot', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'),
  ]

  assert.deepEqual(chooseBotChat(chats), { chatId: 'latest', archived: true })
})

test('only a Bot that never had a chat gets a new one', () => {
  assert.equal(chooseBotChat([]), null)
})

test('turning a Bot into a Task files away every chat still open', () => {
  const chats = [
    chat('a', 'bot', '2026-11-05T00:00:00Z'),
    chat('b', 'bot', '2026-11-04T00:00:00Z', '2026-11-04T01:00:00Z'),
    chat('c', 'bot', '2026-11-03T00:00:00Z'),
  ]

  assert.deepEqual(openBotChats(chats), ['a', 'c'])
})

test("a group chat with only one Bot in it is not that Bot's chat", () => {
  const dm = chat('dm', 'bot', '2026-11-01T00:00:00Z')

  assert.equal(botOfChannel(dm), 'bot')
  assert.equal(botOfChannel({ ...dm, group: true }), undefined)
})
