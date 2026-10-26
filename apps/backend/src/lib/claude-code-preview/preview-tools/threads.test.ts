import { expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { createPreviewToolLog } from '@/routes/agent/chat-preview-tool-log'
import {
  consumePreviewToolPresentation,
  handlePreviewToolUpdate,
} from '@/routes/agent/chat-preview-tool-update'

import { parseToolUpdate } from '../preview-agent-update'
import { createPreviewAssistantPartAccumulator } from '../preview-transcript'
import { threadToolModule } from './threads'

import type { PreviewToolContext } from '../preview-tool-context'

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) })
useAgentDb({
  getConversationBySessionId: async (id) =>
    id === 'source'
      ? {
          sessionId: 'source',
          userId: 'owner',
          teamId: 'team',
          title: 'Source',
          firstMessage: '',
          messageCount: 1,
          createdAt: new Date(),
          lastActiveAt: new Date(),
          credentialAccess: { updatedAt: new Date(), updatedBy: 'owner' },
        }
      : null,
})

test('a refused change reaches the agent as its reason, not an internal error', async () => {
  const ctx = { userId: 'owner', teamId: 'team', sessionId: 'source', locale: 'en' }
  const tools = threadToolModule().handlers(ctx as PreviewToolContext)
  const result = await tools.update_thread?.({
    label: 'x',
    threadId: '00000000-0000-4000-8000-000000000000',
    fullAccess: false,
  })

  expect(result).toMatchObject({ isError: true })
  expect(JSON.stringify(result)).toContain('another conversation you own')
})

test.each([false, true])(
  'a thread message shows one card, the stored ACP call, with revealed permission=%s',
  async (permission) => {
    const log = createPreviewToolLog()
    const order = createPreviewAssistantPartAccumulator()
    const frames: Record<string, unknown>[] = []
    const emit = (frame: Record<string, unknown>) => frames.push(frame)
    const update = (payload: Record<string, unknown>) => {
      const parsed = parseToolUpdate('acp-1', payload)

      if (parsed.kind !== 'tool') throw new Error('expected tool')
      handlePreviewToolUpdate(emit, log, parsed)
      order.appendTool('acp-1')
    }
    const input = {
      label: 'x',
      threadId: '00000000-0000-4000-8000-000000000000',
      prompt: 'status?',
    }

    update({
      title: 'mcp__nuphos-tools__send_message_to_thread',
      status: 'pending',
      rawInput: input,
    })
    // Claude Code asks before an MCP call; the bridge reveals the card even when Full Access allows it.
    if (permission)
      handlePreviewToolUpdate(emit, log, {
        kind: 'tool',
        toolCallId: 'acp-1',
        title: 'send_message_to_thread',
        status: 'pending',
        revealed: true,
      })
    const ctx = { userId: 'owner', teamId: 'team', sessionId: 'source', locale: 'en' }
    const tools = threadToolModule({
      publish: async (_ctx, frame) => {
        // A slow input frame must still land before the result.
        if (frame.type === 'tool-input-available') await Bun.sleep(20)
        if (!consumePreviewToolPresentation(emit, log, frame)) emit(frame)
      },
    }).handlers(ctx as PreviewToolContext)
    const result = await tools.send_message_to_thread?.(input)

    update({ status: 'completed', rawOutput: { result } })

    const cards = frames.filter((frame) => frame.type === 'tool-input-available')

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ toolCallId: 'acp-1', toolName: 'send_message_to_thread' })
    expect(frames.at(-1)).toMatchObject({ type: 'tool-output-error', toolCallId: 'acp-1' })
    expect(order.materialize(log.list())).toHaveLength(1)
  },
)
