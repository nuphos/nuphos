import { expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import { wokenInOwnerBotChat } from './owner-bot-chat'

import type { AgentConversation } from '@/lib/agent/db'

const bot = { sessionId: 'bot', userId: 'owner', teamId: 'team' }
const chat = {
  sessionId: 'chat',
  userId: 'owner',
  teamId: 'team',
  kind: 'channel',
  agentSessionIds: ['bot'],
}
let rows: Record<string, unknown> = {}

useAgentDb({
  getConversationBySessionId: async (id) => (rows[id] ?? null) as AgentConversation | null,
})

const woken = (channelIds = ['chat'], ownerUserId = 'owner') =>
  wokenInOwnerBotChat({ channelIds, agentSessionId: 'bot', ownerUserId })

test("a turn woken in the owner's own chat with the Bot can ask the owner", async () => {
  rows = { bot, chat }
  expect(await woken()).toBe(true)
  expect(await woken(['elsewhere', 'chat'])).toBe(true)
})

test('a group chat, a shared chat, another Bot or another owner cannot', async () => {
  for (const changed of [
    { group: true },
    { participantIds: ['teammate'] },
    { agentSessionIds: ['bot', 'other-bot'] },
    { agentSessionIds: ['other-bot'] },
    { userId: 'teammate' },
    { teamId: 'other-team' },
    { kind: 'chat' },
  ]) {
    rows = { bot, chat: { ...chat, ...changed } }
    expect(await woken()).toBe(false)
  }
  rows = { bot, chat }
  expect(await woken(['elsewhere'])).toBe(false)
  expect(await woken(['chat'], 'teammate')).toBe(false)
  rows = { chat }
  expect(await woken()).toBe(false)
})
