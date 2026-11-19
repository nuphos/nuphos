import { expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import type { AgentMessage } from '@/lib/agent/db'

const at = (index: number, role: 'user' | 'assistant') =>
  ({
    sessionId: 's',
    userId: 'u',
    messageId: `m${String(index)}`,
    index,
    role,
    parts: [{ type: 'text', text: `m${String(index)}` }],
    createdAt: new Date('2026-11-17T00:00:00.000Z'),
  }) as unknown as AgentMessage
// Ten stored messages: the turn's input (8), stored when it started, and its reply (9).
const stored = Array.from({ length: 10 }, (_, index) => at(index, index % 2 ? 'assistant' : 'user'))

useAgentDb({
  getConversationMessages: async (_session, _user, options) => {
    const below = stored.filter(
      (m) => options?.beforeIndex === undefined || m.index < options.beforeIndex,
    )

    return below.slice(-(options?.tail ?? Infinity))
  },
})

const { storedTranscriptTail } = await import('./transcript-tail')

test('a message stored after the turn, before its tail is read, does not move the frame', async () => {
  const turn = { count: 10, lastIndex: 9 }
  const frame = await storedTranscriptTail('s', 'u', undefined, turn, 1)

  expect(frame).toMatchObject({ messagesFirstIndex: 8 })
  // A teammate's message in a shared chat, or a steered one, lands right after the reply.
  stored.push(at(10, 'user'))
  expect(await storedTranscriptTail('s', 'u', undefined, turn, 1)).toEqual(frame)
})
