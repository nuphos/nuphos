import { expect, test } from 'bun:test'

import { messageWrites } from './transcript-message-writes'

import { mintPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { createPreviewAssistantPartAccumulator } from '@/lib/claude-code-preview/preview-transcript'

test('a token streamed across chunks is redacted once the message is assembled', () => {
  const token = mintPreviewMcpToken({ userId: 'u1', sessionId: 'conv-1', teamId: 't1' })
  const parts = createPreviewAssistantPartAccumulator()
  const cut = Math.floor(token.length / 2)

  parts.appendText('token: ')
  parts.appendText(token.slice(0, cut))
  parts.appendText(`${token.slice(cut)} done`)

  const writes = messageWrites(
    {
      sessionId: 'conv-1',
      userId: 'u1',
      teamId: 't1',
      firstMessage: '',
      messages: [{ id: 'm1', role: 'assistant', parts: parts.materialize([]) }],
    } as Parameters<typeof messageWrites>[0],
    { attribution: new Map(), runtimeToolParts: [], storedAt: new Map(), now: new Date(0) },
  )
  const stored = JSON.stringify(writes)

  expect(stored).not.toContain(token.slice(0, cut))
  expect(stored).toContain('token: [redacted] done')
})

test('a well-known key an agent printed is redacted inside its own string', () => {
  const key = 'ghp_abcdefghijklmnopqrstuvwxyz0123'
  const writes = messageWrites(
    {
      sessionId: 'conv-1',
      userId: 'u1',
      teamId: 't1',
      firstMessage: '',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [
            { type: 'text', text: `-----BEGIN PRIVATE KEY-----` },
            { type: 'text', text: `the key is ${key} -----END PRIVATE KEY-----` },
          ],
        },
      ],
    } as Parameters<typeof messageWrites>[0],
    { attribution: new Map(), runtimeToolParts: [], storedAt: new Map(), now: new Date(0) },
  )
  const stored = JSON.stringify(writes)

  expect(stored).not.toContain(key)
  expect(stored).toContain('the key is [REDACTED:github-token]')
  // A PEM shape split across two parts is not one match that swallows both.
  expect(stored).toContain('-----BEGIN PRIVATE KEY-----')
})

test('a long conversation syncs in linear time', () => {
  const messages = Array.from({ length: 6000 }, (_, i) => ({
    id: `m${String(i)}`,
    role: 'assistant' as const,
    parts: [...Array(8).keys()].map((j) => ({
      type: 'tool-exec',
      toolCallId: `t${String(i)}-${String(j)}`,
      state: 'output-available',
      runtimeResult: true,
    })),
  }))
  const startedAt = performance.now()

  messageWrites(
    { sessionId: 'conv-1', userId: 'u1', teamId: 't1', firstMessage: '', messages } as Parameters<
      typeof messageWrites
    >[0],
    {
      attribution: new Map(),
      runtimeToolParts: messages.flatMap((message) => message.parts),
      storedAt: new Map(),
      now: new Date(0),
    },
  )

  // Rebuilding the tool-result map per message took seconds at this size.
  expect(performance.now() - startedAt).toBeLessThan(1500)
})
