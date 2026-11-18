// A turn that fails on a computer with a newer Nuphos waiting says so in the error, the one
// surface every client already shows, old ones included (#3562).
import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import { OUTDATED_HOST_HINT } from '@/lib/claude-code-preview/host-minimum-version'
import { classifyPreviewInterruption } from '@/lib/claude-code-preview/preview-transcript'
import { OpenAbRpcError } from '@/lib/claude-code-preview/openab-acp-errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useChatPreviewFinish } from '@/lib/test/doubles/chat-preview-finish'
import { useChatPreviewPrepare } from '@/lib/test/doubles/chat-preview-prepare'
import { useClaudeCodePreviewRuntime } from '@/lib/test/doubles/claude-code-preview-runtime'
import { useLocalRuntimePresence } from '@/lib/test/doubles/local-runtime-presence'
import { useRedis } from '@/lib/test/doubles/redis'

const restoreFailed = 'Could not restore the saved session; it is kept for the next attempt'

type App = { version: string; update?: { version: string; ready: boolean } }

const desktop = (app: App) => ({
  client: `nuphos-desktop/${app.version}`,
  status: { agents: {}, app },
})
// #3560: Desktop 0.125.0 with 0.127.0 downloaded and waiting for a restart.
const behind = desktop({ version: '0.125.0', update: { version: '0.127.0', ready: true } })
let presence: object = behind
let fail: (() => Error) | null = () => new Error(restoreFailed)
let finished = 0
/** What the person reads in the conversation for the failed turn. */
let summary = ''

useRedis({ redisEnabled: () => false, withRedis: async () => null })
useAgentDb({
  appendTranscriptMessages: (args) =>
    Promise.resolve({ isNew: false, count: args.messages.length }),
})
useLocalRuntimePresence({
  runtimePresenceStore: () => ({
    get: async () => presence,
  }),
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
    if (fail) throw fail()

    return { stopReason: 'end_turn' }
  },
})
useChatPreviewFinish({
  finishPreviewTurn: () => {
    finished++

    return Promise.resolve()
  },
  persistInterruptedPreviewTurn: (args) => {
    summary = classifyPreviewInterruption(args.error, false).message

    return Promise.resolve()
  },
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
  fail = () => new Error(restoreFailed)
  finished = 0
  summary = ''
})

test('a failed turn on a Desktop with a newer release waiting says Nuphos there is out of date', async () => {
  presence = behind
  const error = await runClaudeCodePreviewChatTurn(localTurn('run-old')).catch((e: unknown) => e)

  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(restoreFailed)
  expect((error as Error).message).toContain(OUTDATED_HOST_HINT)
  expect(summary).toBe(`The agent failed before it could answer. ${OUTDATED_HOST_HINT}`)
})

test('a failed turn on an up-to-date Desktop keeps its error as it was', async () => {
  presence = desktop({ version: '0.127.0' })
  const error = await runClaudeCodePreviewChatTurn(localTurn('run-new')).catch((e: unknown) => e)

  expect((error as Error).message).toBe(restoreFailed)
  expect(summary).toBe('The agent failed before it could answer.')
})

test('a turn that succeeds on a Desktop behind the latest release is not touched', async () => {
  presence = behind
  fail = null
  const run = localTurn('run-ok')

  await runClaudeCodePreviewChatTurn(run)

  expect(finished).toBe(1)
  expect(run.run.frames.join('')).not.toContain(OUTDATED_HOST_HINT)
})

test('a failed turn on a Desktop below the support floor says so, though it reports no update', async () => {
  // Desktops that old report no `app` in their status; only the version they connected as.
  presence = { client: 'nuphos-desktop/0.119.0' }
  const error = await runClaudeCodePreviewChatTurn(localTurn('run-floor')).catch((e: unknown) => e)

  expect((error as Error).message).toContain(restoreFailed)
  expect((error as Error).message).toContain(OUTDATED_HOST_HINT)
  expect(summary).toContain(OUTDATED_HOST_HINT)
})

test('a usage limit on a computer with an update waiting still reads as a usage limit', async () => {
  const { agentStreamErrorFrame } = await import('./errors')

  presence = behind
  fail = () =>
    new OpenAbRpcError(
      "**Internal Error** (code: -32603)\nInternal error: You've hit your session limit · resets 4:20am (UTC)",
      -32603,
    )
  const error = await runClaudeCodePreviewChatTurn(localTurn('run-usage')).catch((e: unknown) => e)
  const frame = agentStreamErrorFrame(error, undefined)

  expect(frame.errorCode).toBe('runtime_usage_exhausted')
  expect(frame.errorText).toBe("You've hit your session limit · resets 4:20am (UTC)")
})
