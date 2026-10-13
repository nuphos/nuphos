import '@/routes/agent'

import { expect, test } from 'bun:test'

import { runClaudeCodePreviewChatTurn } from './chat-preview-turn'
import { createAgentRun } from './run-registry'

import { OpenAbConnectionLostError } from '@/lib/claude-code-preview/openab-acp-errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useChatPreviewPrepare } from '@/lib/test/doubles/chat-preview-prepare'
import { useClaudeCodePreviewRuntime } from '@/lib/test/doubles/claude-code-preview-runtime'
import { useRedis } from '@/lib/test/doubles/redis'

const persisted: { messages: { role: string; parts: unknown[] }[] }[] = []
let cause: string | Error = ''
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
    openPromptSuggestion: () => Promise.resolve(),
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
    throw cause instanceof Error ? cause : new Error(cause)
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
    expect(messages.at(-1)!.parts).toContainEqual(
      expect.objectContaining({
        type: 'turn-interrupted',
        diagnostics: expect.objectContaining({
          streamId: run.streamId,
          error: failure.error,
          lastOutputAt: expect.any(String),
          lastTool: expect.objectContaining({ toolCallId: 'pending', status: 'pending' }),
        }),
      }),
    )
    expect(run.frames.join('')).toContain('turn-interrupted')
    expect(run.frames.join('')).not.toContain('atlas-turn-complete')
  }
  expect(cleared).toBe(2)
})

const offline = 'The computer running this agent is offline'
const turnArgs = (run: ReturnType<typeof createAgentRun>) => ({
  run,
  sessionId: run.sessionId,
  userId: run.userId,
  teamId: 'team-failure',
  messages: [
    {
      id: 'user-message',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'fix it' }],
    },
  ],
  origin: 'user' as const,
  firstMessage: 'fix it',
  locale: 'en-US',
  endpoint: { url: 'ws://runtime.invalid/acp', authKey: 'test' },
})

test('a connection lost before the runtime admitted the prompt stays an actionable failure', async () => {
  cause = new OpenAbConnectionLostError(offline)
  const run = createAgentRun('user-failure', 'session-failure', 'run-lost-before-admission')

  await expect(runClaudeCodePreviewChatTurn(turnArgs(run))).rejects.toThrow(offline)

  expect(persisted.at(-1)!.messages.at(-1)!.parts).toContainEqual(
    expect.objectContaining({ type: 'turn-interrupted' }),
  )
  expect(run.frames.join('')).toContain('turn-interrupted')
  expect(run.frames.join('')).not.toContain('atlas-turn-complete')
})

test('a lost runtime connection hands the turn to the reattached session instead of failing it', async () => {
  cause = new OpenAbConnectionLostError(offline, true)
  const run = createAgentRun('user-failure', 'session-failure', 'run-connection-lost')

  await runClaudeCodePreviewChatTurn(turnArgs(run))

  const parts = persisted.at(-1)!.messages.at(-1)!.parts

  expect(parts).toContainEqual(
    expect.objectContaining({
      toolCallId: 'pending',
      state: 'output-error',
      errorText: expect.stringContaining('its reply continues below'),
    }),
  )
  expect(parts).not.toContainEqual(expect.objectContaining({ type: 'turn-interrupted' }))
  expect(run.frames.join('')).not.toContain('turn-interrupted')
  expect(run.frames.join('')).toContain('atlas-turn-complete')
  expect(run.done).toBe(true)
})

test('a typed backend deadline reaches persisted interruption diagnostics', async () => {
  const { OpenAbTimeoutError } = await import('@/lib/claude-code-preview/turn-diagnostics')

  cause = new OpenAbTimeoutError('OpenAB ACP session/prompt timed out', 'inactivity', 12345)
  const run = createAgentRun('user-failure', 'session-failure', 'run-backend-timeout')

  await expect(runClaudeCodePreviewChatTurn(turnArgs(run))).rejects.toThrow('timed out')
  expect(persisted.at(-1)!.messages.at(-1)!.parts).toContainEqual(
    expect.objectContaining({
      type: 'turn-interrupted',
      diagnostics: expect.objectContaining({
        source: 'backend',
        timeoutKind: 'inactivity',
        timeoutMs: 12345,
      }),
    }),
  )
})
