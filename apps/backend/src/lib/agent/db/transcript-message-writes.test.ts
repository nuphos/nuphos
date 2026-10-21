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
