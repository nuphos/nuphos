// Mid-turn steering on the Claude Code runtime: messages queued while a
// prompt runs are delivered right after it resolves, in the same run, and the
// steered exchange is persisted; on abort the queue survives for the next
// turn.
// Enter the routes/agent module graph through its barrel first, so the
// constants ↔ run-pump-helpers cycle initializes in production order.
import '@/routes/agent'

import { beforeEach, describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import {
  buildPendingUserMessage,
  drainPendingUserMessages,
  enqueuePendingUserMessage,
} from '@/lib/agent/pending-messages'
import { useChatPreviewFinish } from '@/lib/test/doubles/chat-preview-finish'
import { useChatPreviewPrepare } from '@/lib/test/doubles/chat-preview-prepare'
import { useClaudeCodePreviewRuntime } from '@/lib/test/doubles/claude-code-preview-runtime'

const ENDPOINT = { url: 'ws://openab-team-t1.openab-runtimes.svc:8080/acp', authKey: 'k' }
const USER = 'user-1'
const SESSION = 'conv-loop'

const seen = {
  prompts: [] as string[],
  actors: [] as string[],
  finish: [] as Record<string, unknown>[],
}
let onPrompt: (message: string) => Promise<void> = (_message) => Promise.resolve()

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
  runClaudeCodePreviewPrompt: async (args) => {
    seen.prompts.push(args.message)
    seen.actors.push(args.userId)
    const emitDelta = args.onTextDelta

    emitDelta(`answer ${String(seen.prompts.length)}`)
    await onPrompt(args.message)

    return { stopReason: 'end_turn' }
  },
})
useChatPreviewFinish({
  finishPreviewTurn: (args) => {
    seen.finish.push(args)

    return Promise.resolve()
  },
})

const { runClaudeCodePreviewChatTurn } = await import('./chat-preview-turn')
const { createAgentRun } = await import('./run-registry')

function turnArgs(run: ReturnType<typeof createAgentRun>) {
  return {
    run,
    sessionId: SESSION,
    teamId: 'team-1',
    userId: USER,
    messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'start' }] }] as UIMessage[],
    origin: 'user' as const,
    firstMessage: 'start',
    locale: 'en-US',
    endpoint: ENDPOINT,
  }
}

beforeEach(async () => {
  seen.prompts = []
  seen.actors = []
  seen.finish = []
  onPrompt = () => Promise.resolve()
  await drainPendingUserMessages(USER, SESSION)
})

describe('runClaudeCodePreviewChatTurn steering', () => {
  test('does not turn a backend queued message into an autonomous runtime prompt', async () => {
    onPrompt = async () => {
      // A message lands while the first prompt is still running.
      if (seen.prompts.length === 1) {
        await enqueuePendingUserMessage(
          USER,
          SESSION,
          buildPendingUserMessage({
            renderedText: 'Bob: 改查 staging',
            source: 'slack',
            actorUserId: 'actor-a',
          }),
        )
      }
    }
    const run = createAgentRun(USER, SESSION, 'stream-steer-1', {
      requestId: 'request-a',
      userId: 'actor-a',
      sessionId: SESSION,
      streamId: 'stream-steer-1',
      route: 'slack.agent',
      method: 'TRIGGER',
    })

    await runClaudeCodePreviewChatTurn({ ...turnArgs(run), actorUserId: 'actor-a' })

    expect(seen.prompts).toHaveLength(1)
    expect(seen.actors).toEqual(['actor-a'])
    const finish = seen.finish[0]!

    expect(finish.text).toBe('answer 1')
    const pending = await drainPendingUserMessages(USER, SESSION)

    expect(pending).toHaveLength(1)
    expect(JSON.stringify(pending)).toContain('改查 staging')
  })

  test("leaves another participant's message for that participant's successor turn", async () => {
    onPrompt = async () => {
      if (seen.prompts.length === 1) {
        await enqueuePendingUserMessage(
          USER,
          SESSION,
          buildPendingUserMessage({
            renderedText: 'Bob: delete production',
            source: 'slack',
            actorUserId: 'actor-b',
          }),
        )
      }
    }
    const run = createAgentRun(USER, SESSION, 'stream-principal-boundary', {
      requestId: 'request-a',
      userId: 'actor-a',
      sessionId: SESSION,
      streamId: 'stream-principal-boundary',
      route: 'slack.agent',
      method: 'TRIGGER',
    })

    await runClaudeCodePreviewChatTurn({ ...turnArgs(run), actorUserId: 'actor-a' })

    expect(seen.prompts).toEqual(['first prompt'])
    expect(seen.actors).toEqual(['actor-a'])
    expect(
      (await drainPendingUserMessages(USER, SESSION, 'actor-b')).map((entry) => entry.renderedText),
    ).toEqual(['Bob: delete production'])
  })

  test('keeps transcript ownership separate from the execution principal', async () => {
    const run = createAgentRun(USER, SESSION, 'stream-actor', {
      requestId: 'request-actor',
      userId: 'actor-2',
      sessionId: SESSION,
      streamId: 'stream-actor',
      route: 'slack.agent',
      method: 'TRIGGER',
    })

    await runClaudeCodePreviewChatTurn({ ...turnArgs(run), actorUserId: 'actor-2' })

    expect(seen.actors).toEqual(['actor-2'])
    expect((seen.finish[0] as { userId?: string }).userId).toBe(USER)
  })

  test('an aborted turn leaves queued messages for the next turn', async () => {
    const run = createAgentRun(USER, SESSION, 'stream-steer-2')

    onPrompt = async () => {
      await enqueuePendingUserMessage(
        USER,
        SESSION,
        buildPendingUserMessage({ renderedText: 'too late', source: 'app' }),
      )
      run.abortController.abort()
    }
    await runClaudeCodePreviewChatTurn(turnArgs(run))

    expect(seen.prompts).toHaveLength(1)
    const kept = await drainPendingUserMessages(USER, SESSION)

    expect(kept.map((entry) => entry.renderedText)).toEqual(['too late'])
  })
})
