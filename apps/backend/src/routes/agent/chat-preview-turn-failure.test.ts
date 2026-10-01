import '@/routes/agent'

import { expect, test } from 'bun:test'

import { runClaudeCodePreviewChatTurn } from './chat-preview-turn'
import { createAgentRun } from './run-registry'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useChatPreviewPrepare } from '@/lib/test/doubles/chat-preview-prepare'
import { useClaudeCodePreviewRuntime } from '@/lib/test/doubles/claude-code-preview-runtime'
import { useRedis } from '@/lib/test/doubles/redis'

const persisted: { messages: { role: string; parts: unknown[] }[] }[] = []
let cause = ''
let cleared = 0

useRedis({ redisEnabled: () => false, withRedis: async () => null })
useAgentDb({
  syncConversationTranscript: (args) => {
    persisted.push({ messages: args.messages })

    return Promise.resolve(null)
  },
})
useChatPreviewPrepare({
  preparePreviewTurn: async () => ({
    memory: null,
    systemPrompt: undefined,
    message: 'fix it',
    freshSessionMessage: () => 'fix it',
    carried: [],
    clearActiveTurn: async () => {
      cleared++
    },
  }),
  carriedUserMessages: () => [],
})
useClaudeCodePreviewRuntime({
  runClaudeCodePreviewPrompt: async (args) => {
    args.onTextDelta('Saved the first change.')
    args.onAgentUpdate?.({
      kind: 'tool',
      toolCallId: 'saved',
      title: 'Write file',
      status: 'completed',
      rawInput: { path: 'fix.go' },
      rawOutput: 'saved',
    })
    args.onTextDelta('Now running the tests.')
    args.onAgentUpdate?.({
      kind: 'tool',
      toolCallId: 'pending',
      title: 'Run tests',
      status: 'in_progress',
      rawInput: { command: 'go test' },
    })
    throw new Error(cause)
  },
})

test('runtime failures persist partial work and close dangling tools instead of successful answers', async () => {
  for (const failure of [
    { error: 'ENOSPC: no space left on device', reason: 'error' },
    { error: 'Agent exceeded hard timeout (1800s)', reason: 'timeout' },
  ]) {
    cause = failure.error
    const run = createAgentRun('user-failure', 'session-failure', `run-${failure.reason}`)

    await expect(
      runClaudeCodePreviewChatTurn({
        run,
        sessionId: run.sessionId,
        userId: run.userId,
        teamId: 'team-failure',
        messages: [{ id: 'user-message', role: 'user', parts: [{ type: 'text', text: 'fix it' }] }],
        origin: 'user' as const,
        firstMessage: 'fix it',
        locale: 'en-US',
        endpoint: { url: 'ws://runtime.invalid/acp', authKey: 'test' },
      }),
    ).rejects.toThrow(failure.error)

    const messages = persisted.at(-1)!.messages

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(messages.at(-1)!.parts).toEqual([
      expect.objectContaining({ type: 'text', text: 'Saved the first change.' }),
      expect.objectContaining({
        toolCallId: 'saved',
        state: 'output-available',
        output: 'saved',
      }),
      expect.objectContaining({ type: 'text', text: 'Now running the tests.' }),
      expect.objectContaining({ toolCallId: 'pending', state: 'output-error' }),
      expect.objectContaining({ type: 'turn-interrupted', reason: failure.reason }),
    ])
    expect(run.frames.join('')).toContain('turn-interrupted')
    expect(run.frames.join('')).not.toContain('atlas-turn-complete')
  }
  expect(cleared).toBe(2)
})
