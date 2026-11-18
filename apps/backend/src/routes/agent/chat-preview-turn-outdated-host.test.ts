// A turn that fails on a computer whose Nuphos is older than supported says so in the error,
// the one surface every client already shows, old ones included (#3562).
import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'

import { OUTDATED_HOST_HINT } from '@/lib/claude-code-preview/host-minimum-version'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useChatPreviewFinish } from '@/lib/test/doubles/chat-preview-finish'
import { useChatPreviewPrepare } from '@/lib/test/doubles/chat-preview-prepare'
import { useClaudeCodePreviewRuntime } from '@/lib/test/doubles/claude-code-preview-runtime'
import { useLocalRuntimePresence } from '@/lib/test/doubles/local-runtime-presence'
import { useRedis } from '@/lib/test/doubles/redis'

import type { UIMessage } from 'ai'

const restoreFailed = 'Could not restore the saved session; it is kept for the next attempt'
let client = 'nuphos-desktop/0.123.0'
let fail = true
let finished = 0

useRedis({ redisEnabled: () => false, withRedis: async () => null })
useAgentDb({
  appendTranscriptMessages: (args) =>
    Promise.resolve({ isNew: false, count: args.messages.length }),
})
useLocalRuntimePresence({
  runtimePresenceStore: () =>
    ({ get: async () => ({ client }) }) as unknown as ReturnType<
      typeof import('@/lib/agent/devices/local-runtime/presence').runtimePresenceStore
    >,
})
useChatPreviewPrepare({
  preparePreviewTurn: async () => ({
    memory: null,
    systemPrompt: undefined,
    message: 'go',
    freshSessionMessage: () => 'go',
    carried: [],
    openPromptSuggestion: () => Promise.resolve(),
    clearActiveTurn: () => Promise.resolve(),
  }),
  carriedUserMessages: () => [],
})
useClaudeCodePreviewRuntime({
  runClaudeCodePreviewPrompt: async (args) => {
    args.onTextDelta('Done.')
    if (fail) throw new Error(restoreFailed)

    return { stopReason: 'end_turn' }
  },
})
useChatPreviewFinish({
  finishPreviewTurn: () => {
    finished++

    return Promise.resolve()
  },
  persistInterruptedPreviewTurn: () => Promise.resolve(),
})

const { runClaudeCodePreviewChatTurn } = await import('./chat-preview-turn')
const { createAgentRun } = await import('./run-registry')

function localTurn(streamId: string) {
  const run = createAgentRun('user-outdated', 'session-outdated', streamId)

  return {
    run,
    sessionId: run.sessionId,
    userId: run.userId,
    teamId: 'team-outdated',
    messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'go' }] }] as UIMessage[],
    origin: 'user' as const,
    firstMessage: 'go',
    locale: 'en-US',
    endpoint: {
      url: 'ws://runtime.invalid/acp',
      authKey: 'k',
      provider: 'codex' as const,
      local: { userId: 'user-outdated', deviceId: 'device-1' },
    },
  }
}

beforeEach(() => {
  fail = true
  finished = 0
})

test('a failed turn on a computer below the minimum version says Nuphos there is out of date', async () => {
  client = 'nuphos-desktop/0.123.0'
  const error = await runClaudeCodePreviewChatTurn(localTurn('run-old')).catch((e: unknown) => e)

  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(restoreFailed)
  expect((error as Error).message).toContain(OUTDATED_HOST_HINT)
})

test('a failed turn on a supported computer keeps its error as it was', async () => {
  client = 'nuphos-desktop/0.124.0'
  const error = await runClaudeCodePreviewChatTurn(localTurn('run-new')).catch((e: unknown) => e)

  expect((error as Error).message).toBe(restoreFailed)
})

test('a turn that succeeds on an old computer is not touched', async () => {
  client = 'nuphos-desktop/0.123.0'
  fail = false
  const run = localTurn('run-ok')

  await runClaudeCodePreviewChatTurn(run)

  expect(finished).toBe(1)
  expect(run.run.frames.join('')).not.toContain(OUTDATED_HOST_HINT)
})
