// A replica that shuts down mid-turn saves what streamed so far and leaves the
// turn running; shutdown hands the session on (runtime-handoff.test.ts).
import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'

import type { PreviewAgentUpdate } from '@/lib/claude-code-preview/openab-acp-client'
import type { UIMessage } from 'ai'

import { RunHandoff } from '@/lib/lifecycle'
import { useChatPreviewFinish } from '@/lib/test/doubles/chat-preview-finish'
import { useChatPreviewPrepare } from '@/lib/test/doubles/chat-preview-prepare'
import { useClaudeCodePreviewRuntime } from '@/lib/test/doubles/claude-code-preview-runtime'

const ENDPOINT = { url: 'ws://openab-team-t1.openab-runtimes.svc:8080/acp', authKey: 'k' }
const seen = {
  handedOff: [] as Record<string, unknown>[],
  finishes: 0,
  interruptions: 0,
  released: 0,
}
let admitted: () => void = () => {}

useChatPreviewPrepare({
  preparePreviewTurn: () =>
    Promise.resolve({
      memory: null,
      systemPrompt: undefined,
      message: 'deploy it',
      freshSessionMessage: () => 'deploy it',
      carried: [],
      openPromptSuggestion: () => Promise.resolve(),
      clearActiveTurn: () => {
        seen.released++

        return Promise.resolve()
      },
    }),
  carriedUserMessages: () => [],
})
useClaudeCodePreviewRuntime({
  runClaudeCodePreviewPrompt: (args: {
    onTextDelta: (delta: string) => void
    onAgentUpdate?: (update: PreviewAgentUpdate) => void
  }) =>
    new Promise(() => {
      args.onTextDelta('Creating the project.')
      args.onAgentUpdate?.({
        kind: 'tool',
        toolCallId: 'tool-running',
        title: 'Terminal',
        status: 'in_progress',
        rawInput: { command: 'zeabur project create' },
      })
      admitted()
    }),
})
useChatPreviewFinish({
  finishPreviewTurn: () => {
    seen.finishes++

    return Promise.resolve()
  },
  persistInterruptedPreviewTurn: () => {
    seen.interruptions++

    return Promise.resolve()
  },
  persistHandedOffPreviewTurn: (args) => {
    seen.handedOff.push(args)

    return Promise.resolve()
  },
})
const { runClaudeCodePreviewChatTurn } = await import('./chat-preview-turn')
const { createAgentRun } = await import('./run-registry')

beforeEach(() => {
  seen.handedOff = []
  seen.finishes = 0
  seen.interruptions = 0
  seen.released = 0
})

test('shutdown hands a running turn off instead of ending it', async () => {
  const run = createAgentRun('owner', 'conv-live', 'stream-live', {
    requestId: 'request-live',
    userId: 'actor',
    sessionId: 'conv-live',
    streamId: 'stream-live',
    route: '/agent/chat',
    method: 'POST',
  })
  const running = new Promise<void>((resolve) => {
    admitted = resolve
  })
  const turn = runClaudeCodePreviewChatTurn({
    run,
    sessionId: 'conv-live',
    teamId: 'team-1',
    userId: 'owner',
    actorUserId: 'actor',
    messages: [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'deploy it' }] },
    ] as UIMessage[],
    origin: 'user',
    firstMessage: 'deploy it',
    locale: 'zh-TW',
    endpoint: ENDPOINT,
  })

  await running
  run.abortController.abort(new RunHandoff('backend shutdown'))
  await turn

  expect(seen.finishes).toBe(0)
  expect(seen.interruptions).toBe(0)
  expect(seen.released).toBe(1)
  expect(seen.handedOff).toHaveLength(1)
  expect(seen.handedOff[0]?.orderedParts).toEqual([
    { type: 'text', text: 'Creating the project.' },
    expect.objectContaining({
      toolCallId: 'tool-running',
      state: 'output-error',
      errorText: expect.stringContaining('kept running'),
    }),
  ])
})
