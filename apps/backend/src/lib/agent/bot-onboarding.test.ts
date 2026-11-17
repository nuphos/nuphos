import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useDb } from '@/lib/test/doubles/db'

import { startBotOnboarding } from './bot-onboarding'

let bot: Record<string, unknown>
let chat: Record<string, unknown>
let calls: string[]
let reject = false

useAgentDb({ getConversationBySessionId: async (id) => (id === 'bot' ? bot : chat) })
useConversationTurn({
  startConversationTurn: async (_data, _bot, text) => {
    if (reject) throw new Error('Runtime unavailable')
    calls.push(text)

    return { status: 'started', run: Promise.resolve() }
  },
})
useDb({
  db: () => ({
    collection: () => ({
      updateOne: async (
        query: Record<string, unknown>,
        update: { $set: Record<string, unknown> },
      ) => {
        if (bot.botOnboarding !== query.botOnboarding) return { modifiedCount: 0 }
        Object.assign(bot, update.$set)

        return { modifiedCount: 1 }
      },
    }),
  }),
})
beforeEach(() => {
  bot = { sessionId: 'bot', userId: 'u', teamId: 't', avatar: '07-ada', botOnboarding: 'pending' }
  chat = { sessionId: 'chat', userId: 'u', teamId: 't', kind: 'channel', agentSessionIds: ['bot'] }
  calls = []
  reject = false
})
test('concurrent requests introduce the Bot once, in its own chat', async () => {
  const results = await Promise.all([
    startBotOnboarding('u', 't', 'bot', 'chat'),
    startBotOnboarding('u', 't', 'bot', 'chat'),
  ])

  expect(results.filter((r) => r.started)).toHaveLength(1)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toContain('channelId chat')
  expect(calls[0]).toContain('channel_post')
  expect(calls[0]).toContain('one focused question')
})
test('ordinary existing Bots are never reintroduced', async () => {
  delete bot.botOnboarding
  expect(await startBotOnboarding('u', 't', 'bot', 'chat')).toEqual({ started: false })
  expect(calls).toHaveLength(0)
})
test('wrong owners, teams, unrelated and shared chats cannot trigger onboarding', async () => {
  for (const change of [
    { userId: 'v' },
    { teamId: 'other' },
    { agentSessionIds: ['other'] },
    { agentSessionIds: ['bot', 'other'] },
    { participantIds: ['v'] },
    { archivedAt: new Date() },
    { generalAccess: 'reply' },
  ]) {
    const saved = { ...chat }

    Object.assign(chat, change)
    await expect(startBotOnboarding('u', 't', 'bot', 'chat')).rejects.toThrow('not found')
    chat = saved
  }
  expect(calls).toHaveLength(0)
})
test('a rejected runtime handoff can be retried on the same Bot', async () => {
  reject = true
  await expect(startBotOnboarding('u', 't', 'bot', 'chat')).rejects.toThrow('Runtime unavailable')
  expect(bot.botOnboarding).toBe('pending')
  reject = false
  expect(await startBotOnboarding('u', 't', 'bot', 'chat')).toEqual({ started: true })
  expect(calls).toHaveLength(1)
})
