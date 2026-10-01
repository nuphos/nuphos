// A turn that resolves with the "(no response)" sentinel while its last tool
// never reported output means the inner agent is blocked (an unanswered
// permission request). The turn must cancel the inner session so the next
// prompt starts immediately instead of idling into the gateway's 180s
// timeout — and must NOT cancel after a healthy completion.
// Enter the routes/agent module graph through its barrel first, so the
// constants ↔ run-pump-helpers cycle initializes in production order.
import '@/routes/agent'

import { beforeEach, describe, expect, test } from 'bun:test'

import type { PreviewAgentUpdate } from '@/lib/claude-code-preview/openab-acp-client'
import type { UIMessage } from 'ai'

import { useChatPreviewFinish } from '@/lib/test/doubles/chat-preview-finish'
import { useChatPreviewPrepare } from '@/lib/test/doubles/chat-preview-prepare'
import { useClaudeCodePreviewRuntime } from '@/lib/test/doubles/claude-code-preview-runtime'

const ENDPOINT = { url: 'ws://openab-team-t1.openab-runtimes.svc:8080/acp', authKey: 'k' }
const USER = 'user-1'
const SESSION = 'conv-empty'
const TEAM = 'team-1'

const seen = {
  cancels: [] as { teamId: string; conversationId: string }[],
  finishes: [] as Record<string, unknown>[],
  interruptions: [] as Record<string, unknown>[],
}
let promptStopReason = 'end_turn'
let promptResult = () => Promise.resolve({ stopReason: promptStopReason })
let promptBehavior: (args: {
  onTextDelta: (delta: string) => void
  onAgentUpdate?: (update: PreviewAgentUpdate) => void
}) => void = () => {}

useChatPreviewPrepare({
  preparePreviewTurn: () =>
    Promise.resolve({
      memory: null,
      systemPrompt: undefined,
      message: 'first prompt',
      freshSessionMessage: () => 'first prompt',
      carried: [],
      clearActiveTurn: () => Promise.resolve(),
    }),
  carriedUserMessages: () => [],
})
useClaudeCodePreviewRuntime({
  runClaudeCodePreviewPrompt: (args) => {
    promptBehavior(args)

    return promptResult()
  },
  cancelPreviewConversationSession: (teamId: string, conversationId: string) => {
    seen.cancels.push({ teamId, conversationId })

    return true
  },
})
useChatPreviewFinish({
  finishPreviewTurn: (args) => {
    seen.finishes.push(args)

    return Promise.resolve()
  },
  persistInterruptedPreviewTurn: (args) => {
    seen.interruptions.push(args)

    return Promise.resolve()
  },
})

const { runClaudeCodePreviewChatTurn } = await import('./chat-preview-turn')
const { createAgentRun } = await import('./run-registry')

function turnArgs(streamId: string) {
  const run = createAgentRun(USER, SESSION, streamId, {
    requestId: `request-${streamId}`,
    userId: USER,
    sessionId: SESSION,
    streamId,
    route: '/agent/chat',
    method: 'POST',
  })

  return {
    run,
    sessionId: SESSION,
    teamId: TEAM,
    userId: USER,
    messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'start' }] }] as UIMessage[],
    origin: 'user' as const,
    firstMessage: 'start',
    locale: 'en-US',
    endpoint: ENDPOINT,
  }
}

beforeEach(() => {
  seen.cancels = []
  seen.finishes = []
  seen.interruptions = []
  promptStopReason = 'end_turn'
  promptResult = () => Promise.resolve({ stopReason: promptStopReason })
  promptBehavior = () => {}
})

describe('runClaudeCodePreviewChatTurn empty completion', () => {
  test('a completed native prompt with an unfinished background tool is never cancelled by backend', async () => {
    promptBehavior = (args) => {
      args.onAgentUpdate?.({
        kind: 'tool',
        toolCallId: 'tool-1',
        title: 'Write rbac_scan.py',
        status: 'in_progress',
        rawInput: { file_path: 'rbac_scan.py' },
      })
      args.onTextDelta('_(no response)_')
    }
    await runClaudeCodePreviewChatTurn(turnArgs('stream-empty-1'))

    expect(seen.cancels).toEqual([])
  })

  test('does not cancel after a healthy completion', async () => {
    promptBehavior = (args) => {
      args.onAgentUpdate?.({
        kind: 'tool',
        toolCallId: 'tool-1',
        title: 'ls',
        status: 'in_progress',
        rawInput: {},
      })
      args.onAgentUpdate?.({
        kind: 'tool',
        toolCallId: 'tool-1',
        title: 'ls',
        status: 'completed',
        rawOutput: 'file.txt',
      })
      args.onTextDelta('Here is the listing.')
    }
    await runClaudeCodePreviewChatTurn(turnArgs('stream-empty-2'))

    expect(seen.cancels).toEqual([])
  })

  test('uses the runtime cancellation response as the turn boundary', async () => {
    promptStopReason = 'cancelled'
    promptBehavior = (args) => {
      args.onTextDelta('Partial work.')
      args.onAgentUpdate?.({
        kind: 'tool',
        toolCallId: 'tool-cancelled',
        title: 'Long command',
        status: 'in_progress',
        rawInput: { command: 'sleep 30' },
      })
    }
    const args = turnArgs('stream-cancelled')
    let resolvePrompt: ((result: { stopReason: string }) => void) | undefined
    let markPromptEntered: (() => void) | undefined
    const promptEntered = new Promise<void>((resolve) => {
      markPromptEntered = resolve
    })

    promptResult = () =>
      new Promise((resolve) => {
        resolvePrompt = resolve
        markPromptEntered?.()
      })
    const turn = runClaudeCodePreviewChatTurn(args)

    await promptEntered
    expect(args.run.done).toBe(false)
    resolvePrompt?.({ stopReason: 'cancelled' })
    await turn

    expect(seen.finishes).toHaveLength(1)
    expect(seen.interruptions).toEqual([])
    expect(args.run.done).toBe(true)
    expect(args.run.frames.join('')).toContain('atlas-turn-complete')
  })

  test('a turn this backend aborted is persisted as interrupted, not completed', async () => {
    const args = turnArgs('stream-aborted')

    promptBehavior = (prompt) => {
      prompt.onAgentUpdate?.({
        kind: 'tool',
        toolCallId: 'tool-running',
        title: 'Terminal',
        status: 'in_progress',
        rawInput: {},
      })
      args.run.abortController.abort()
      prompt.onTextDelta('_(no response)_')
    }
    promptStopReason = 'cancelled'
    await runClaudeCodePreviewChatTurn(args)

    expect(seen.finishes).toEqual([])
    expect(seen.interruptions).toHaveLength(1)
    const parts = seen.interruptions[0]?.orderedParts as Record<string, unknown>[]

    expect(parts).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-running',
        state: 'output-error',
        errorText: 'Interrupted before the tool finished.',
      }),
    ])
    expect(args.run.done).toBe(true)
  })

  test('passes commentary and tools to persistence in their runtime order', async () => {
    promptBehavior = (args) => {
      args.onTextDelta('Checking the rules.')
      args.onAgentUpdate?.({
        kind: 'tool',
        toolCallId: 'tool-1',
        title: 'Read',
        status: 'completed',
        rawInput: {},
        rawOutput: 'rules',
      })
      args.onTextDelta('Found 361 suspicious reads.')
    }
    await runClaudeCodePreviewChatTurn(turnArgs('stream-ordered-parts'))

    expect(seen.finishes[0]?.orderedParts).toEqual([
      { type: 'text', text: 'Checking the rules.' },
      {
        type: 'tool-Read',
        toolCallId: 'tool-1',
        state: 'output-available',
        input: {},
        startedAt: expect.any(Number),
        completedAt: expect.any(Number),
        output: 'rules',
      },
      { type: 'text', text: 'Found 361 suspicious reads.' },
    ])
  })
})
