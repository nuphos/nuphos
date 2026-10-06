import { beforeEach, expect, test } from 'bun:test'

import { attributeAppMessages } from '@/lib/agent/message-attribution'
import { renderAttributedMessage } from '@/lib/agent/message-metadata'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'

import type { AgentConversation } from '@/lib/agent/db'
import type { UIMessage } from 'ai'

let conversation: AgentConversation | null = null
let stored: { messageId: string; role: string; parts: unknown[] }[] = []

const OWNER = '64b5f1c2e4b0a1d2c3e4f5a6'

useIdentity({ authenticateToken: async () => ({ user: { id: OWNER } }) })
useSlackAgentBot({ getSlackAgentThreadBySessionId: async () => null })
useAgentDb({
  getConversationBySessionId: async () => conversation,
  syncConversationTranscript: async (data) => {
    stored = data.messages.map((message) => ({ ...message, messageId: message.id }))

    return { isNew: true }
  },
})
useDb({
  db: () => ({
    collection: () => ({
      find: () => ({ toArray: async () => stored }),
      findOne: async () => null,
    }),
  }),
})

await import('./routes-conversations-mutations')
const { agent } = await import('./router')

beforeEach(() => {
  conversation = null
  stored = []
})

test.each(['codex', 'claude-code'])(
  '%s first message retains attribution when transcript PUT wins the race',
  async (agentRuntime) => {
    const messages: UIMessage[] = [
      { id: 'first', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ]
    const response = await agent.request('/conversations/new-session/transcript', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ agentRuntime, messages }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, skipped: 'server_authoritative' })
    expect(stored).toEqual([])

    await attributeAppMessages(messages, 'new-session', OWNER, OWNER, false)
    expect(renderAttributedMessage('first', 'hello', messages[0]!.metadata)).toContain(
      `"id":"${OWNER}"`,
    )
  },
)

test('a delayed PUT cannot overwrite a native transcript after chat creates it', async () => {
  conversation = {
    sessionId: 'new-session',
    userId: OWNER,
    agentRuntime: 'codex',
  } as AgentConversation
  const response = await agent.request('/conversations/new-session/transcript', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify({ messages: [{ id: 'first', role: 'user', parts: [] }] }),
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, skipped: 'server_authoritative' })
  expect(stored).toEqual([])
})
