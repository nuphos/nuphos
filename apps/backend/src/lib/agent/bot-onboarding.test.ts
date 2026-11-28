import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useDb } from '@/lib/test/doubles/db'

import { greetFromTask, startBotOnboarding } from './bot-onboarding'

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
      findOneAndUpdate: async (query: Record<string, unknown>) => {
        if (bot.botGreeting !== query.botGreeting || bot.userId !== query.userId) return null
        const before = { ...bot }

        delete bot.botGreeting

        return before
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
  expect(bot.botOnboarding).toBe('active')
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

test('legacy introductions are not restarted as new setup', async () => {
  bot.botOnboarding = 'started'
  expect(await startBotOnboarding('u', 't', 'bot', 'chat')).toEqual({ started: false })
  expect(calls).toHaveLength(0)
})

test('a Task made a Bot greets once, in the first chat its owner opens with it', async () => {
  bot.botGreeting = 'pending'
  delete bot.botOnboarding
  await Promise.all([
    greetFromTask('u', 't', 'bot', chat as never),
    greetFromTask('u', 't', 'bot', chat as never),
  ])

  expect(calls).toHaveLength(1)
  expect(calls[0]).toContain('channelId chat')
  expect(calls[0]).toContain('channel_post')
  expect(calls[0]).toContain('earlier work is still in your Task')
  expect(bot.botGreeting).toBeUndefined()
  await greetFromTask('u', 't', 'bot', chat as never)
  expect(calls).toHaveLength(1)
})
test('a Bot not just made from a Task never greets', async () => {
  delete bot.botOnboarding
  await greetFromTask('u', 't', 'bot', chat as never)
  expect(calls).toHaveLength(0)
})
test('a shared or unrelated chat neither gets the greeting nor uses it up', async () => {
  bot.botGreeting = 'pending'
  for (const change of [
    { userId: 'v' },
    { agentSessionIds: ['bot', 'other'] },
    { participantIds: ['v'] },
    { generalAccess: 'reply' },
    { archivedAt: new Date() },
  ]) {
    await greetFromTask('u', 't', 'bot', { ...chat, ...change } as never)
  }
  await greetFromTask('v', 't', 'bot', { ...chat, userId: 'v' } as never)
  expect(calls).toHaveLength(0)
  expect(bot.botGreeting).toBe('pending')
})
test('a greeting that cannot start leaves the Bot in its chat', async () => {
  bot.botGreeting = 'pending'
  reject = true
  await greetFromTask('u', 't', 'bot', chat as never)
  expect(calls).toHaveLength(0)
})
