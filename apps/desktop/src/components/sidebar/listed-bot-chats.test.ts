import assert from 'node:assert/strict'
import test from 'node:test'

import { listedBotChats } from './listed-bot-chats.ts'

import type { AgentConversation } from '../../api/agent-types.ts'

const agent = (sessionId: string, extra: Partial<AgentConversation> = {}) =>
  ({
    sessionId,
    title: sessionId,
    createdAt: '2026-11-01T00:00:00Z',
    lastActiveAt: '2026-11-01T00:00:00Z',
    ...extra,
  }) as AgentConversation
const chatWith = (sessionId: string, botId: string) =>
  agent(sessionId, { kind: 'channel', faces: [{ id: botId, name: botId, agent: {} }] })
const none = new Map<string, string | null>()

test('a chat whose agent is no longer a Bot is a plain chat', () => {
  const sessions = [
    chatWith('bot-chat', 'bot'),
    chatWith('former-chat', 'former'),
    agent('bot', { avatar: '05-rembrandt' }),
    agent('former'),
  ]

  assert.deepEqual([...listedBotChats(sessions, none)], [['bot-chat', 'bot']])
})

test('a face picked since the last fetch decides, either way', () => {
  assert.equal(
    listedBotChats(
      [chatWith('chat', 'bot'), agent('bot', { avatar: '05-rembrandt' })],
      new Map([['bot', null]]),
    ).size,
    0,
  )
  assert.equal(
    listedBotChats([chatWith('chat', 'bot'), agent('bot')], new Map([['bot', '05-rembrandt']]))
      .size,
    1,
  )
})

test("a Bot the list does not hold, such as a teammate's, keeps its chat", () => {
  assert.deepEqual([...listedBotChats([chatWith('chat', 'theirs')], none)], [['chat', 'theirs']])
})
