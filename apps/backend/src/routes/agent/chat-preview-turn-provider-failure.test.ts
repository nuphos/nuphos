import '@/routes/agent'

import { expect, test } from 'bun:test'

import { runClaudeCodePreviewChatTurn } from './chat-preview-turn'
import { createAgentRun } from './run-registry'

import { CodexTurnFailedError } from '@/lib/claude-code-preview/codex-turn-failure'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useChatPreviewPrepare } from '@/lib/test/doubles/chat-preview-prepare'
import { useClaudeCodePreviewRuntime } from '@/lib/test/doubles/claude-code-preview-runtime'
import { useRedis } from '@/lib/test/doubles/redis'

const NOTICE =
  'This request was blocked by our safety systems. Reason: Potentially unintended activity.\n\n'
const persisted: { messages: { role: string; parts: unknown[] }[] }[] = []

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
    message: 'how many services use func-runtime-node20:latest',
    freshSessionMessage: () => 'how many services use func-runtime-node20:latest',
    carried: [],
    openPromptSuggestion: () => Promise.resolve(),
    clearActiveTurn: async () => {},
  }),
  carriedUserMessages: () => [],
})
useClaudeCodePreviewRuntime({
  runClaudeCodePreviewPrompt: async (args) => {
    args.onTextDelta('我查一下')
    args.onTextDelta('目前')
    args.onTextDelta(NOTICE)
    throw new CodexTurnFailedError(NOTICE)
  },
})

test('a provider-refused Codex turn keeps its prose and reports the refusal as the turn failure', async () => {
  const run = createAgentRun('user-refused', 'session-refused', 'run-refused')

  await expect(
    runClaudeCodePreviewChatTurn({
      run,
      sessionId: run.sessionId,
      userId: run.userId,
      teamId: 'team-refused',
      messages: [{ id: 'user-message', role: 'user', parts: [{ type: 'text', text: 'ask' }] }],
      origin: 'user' as const,
      firstMessage: 'ask',
      locale: 'zh-TW',
      endpoint: { url: 'ws://runtime.invalid/acp', authKey: 'test', provider: 'codex' },
    }),
  ).rejects.toBeInstanceOf(CodexTurnFailedError)

  const assistant = persisted.at(-1)!.messages.at(-1)!

  expect(assistant.parts).toEqual([
    expect.objectContaining({ type: 'text', text: '我查一下目前' }),
    expect.objectContaining({
      type: 'turn-interrupted',
      reason: 'error',
      message:
        'The model provider stopped this turn: This request was blocked by our safety systems. Reason: Potentially unintended activity.',
    }),
  ])
  expect(run.frames.join('')).not.toContain('atlas-turn-complete')
})
