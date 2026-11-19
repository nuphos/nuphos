// Same init-order guard as the sibling route tests.
import '@/routes/agent'

import { expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import type { AgentConversation } from '@/lib/agent/db'

const conversation = { sessionId: 's1', userId: 'u1', teamId: 't1' } as AgentConversation

useAgentDb({
  // Every reconnect resumes; a long session's transcript runs to hundreds of MB.
  getConversationWithMessages: async () => {
    throw new Error('a resume read the whole transcript')
  },
  getReadableConversation: async () => conversation,
})

const { resolveChatConversation } = await import('./chat-conversation')

test('a resume reads the conversation, not its transcript', async () => {
  expect(await resolveChatConversation({ id: 's1', resume: true }, 'u1', 't1')).toBe(conversation)
})
