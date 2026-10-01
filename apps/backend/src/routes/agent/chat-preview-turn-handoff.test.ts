import { useFakeRuntimeRequests } from '@/lib/test/doubles/runtime-request-store'
// An approval decided on a client's new stream hands the turn to a NEW run;
// one decided elsewhere (Slack) keeps the live run. A bridge frame sink
// attached to the original run must follow either way, or everything the
// agent says after the approval never reaches the thread.
import '@/routes/agent'

import { beforeEach, describe, expect, test } from 'bun:test'

import type { AgentRun } from './types'
import type { OpenAbPermissionHandler } from '@/lib/claude-code-preview/openab-acp-session'
import type { UIMessage } from 'ai'

import { SlackAgentRunSink } from '@/lib/slack/stream-sink'
import { useChatPreviewFinish } from '@/lib/test/doubles/chat-preview-finish'
import { useChatPreviewPrepare } from '@/lib/test/doubles/chat-preview-prepare'
import { useClaudeCodePreviewRuntime } from '@/lib/test/doubles/claude-code-preview-runtime'
import { useDb } from '@/lib/test/doubles/db'
import { useRedis } from '@/lib/test/doubles/redis'

useRedis({ redisEnabled: () => false, withRedis: async () => null })
useDb({
  db: () => ({ collection: () => ({ findOne: async () => null, updateOne: async () => ({}) }) }),
} as never)

const ENDPOINT = { url: 'ws://openab-team-t1.openab-runtimes.svc:8080/acp', authKey: 'k' }
const USER = 'user-handoff'
const SESSION = 'conv-handoff'

type Prompt = { emit: (delta: string) => void; ask: OpenAbPermissionHandler }
let onPrompt: (prompt: Prompt) => Promise<void> = (_prompt) => Promise.resolve()

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
    await onPrompt({ emit: args.onTextDelta, ask: args.onPermissionRequest! })

    return { stopReason: 'end_turn' }
  },
})
useChatPreviewFinish({ finishPreviewTurn: () => Promise.resolve() })

const { listPendingPreviewWaits, resolvePreviewDecision, resetLocalPreviewWaits } =
  await import('@/lib/claude-code-preview/decision-waiter')
const { runClaudeCodePreviewChatTurn } = await import('./chat-preview-turn')
const { attachAgentRunFrameSink, createAgentRun } = await import('./run-registry')

async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000

  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition never met')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Asks for permission, then approves it — on `streamId` when a client decides. */
async function approve(
  run: () => AgentRun,
  { emit, ask }: Prompt,
  toolCallId: string,
  streamId?: string,
) {
  const before = run()
  const outcome = ask({
    sessionId: 'openab-session',
    toolCall: { toolCallId, title: 'bash' },
    options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }],
  })

  await until(async () => (await listPendingPreviewWaits(USER, SESSION)).length > 0)
  const [wait] = await listPendingPreviewWaits(USER, SESSION)

  expect(before.done).toBe(false)
  await resolvePreviewDecision({
    userId: USER,
    sessionId: SESSION,
    waitId: wait!.waitId,
    payload: { decision: 'approved' },
    ...(streamId ? { streamId } : {}),
  })
  expect(await outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })
  expect(run() === before).toBe(streamId === undefined)
  emit(`after approval on ${run().streamId}. `)
}

beforeEach(() => {
  resetLocalPreviewWaits()
})

describe('runClaudeCodePreviewChatTurn frame sink handoff', () => {
  test('follows a client-decided handoff and stays on the live run for a Slack decision', async () => {
    const posts: string[] = []
    const cards: string[] = []
    const sink = new SlackAgentRunSink(
      (text) => {
        posts.push(text)

        return Promise.resolve()
      },
      undefined,
      (request) => {
        cards.push(String(request.toolCallId))

        return Promise.resolve()
      },
    )
    const run = createAgentRun(USER, SESSION, 'stream-original')
    let current = run
    const attach = (target: AgentRun) => {
      attachAgentRunFrameSink(target, sink, 'test.frame_sink.error', {})
    }

    attach(run)
    onPrompt = async (prompt) => {
      prompt.emit('Let me check. ')
      await approve(() => current, prompt, 'tool-a', 'stream-second')
      await approve(() => current, prompt, 'tool-b')
      prompt.emit('Done.')
    }

    await runClaudeCodePreviewChatTurn({
      run,
      sessionId: SESSION,
      teamId: 'team-1',
      userId: USER,
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'deploy' }] },
      ] as UIMessage[],
      origin: 'user' as const,
      firstMessage: 'deploy',
      locale: 'en-US',
      endpoint: ENDPOINT,
      onRunHandoff: (next) => {
        current = next
        attach(next)
      },
    })
    await sink.settle()

    expect(current.streamId).toBe('stream-second')
    expect(cards).toHaveLength(2)
    expect(posts).toEqual([
      'Let me check.',
      'after approval on stream-second.',
      'after approval on stream-second. Done.',
    ])
    expect(sink.replyTail()).toContain('Done.')
    expect(sink.terminal()).toBe('complete')
  })
})

useFakeRuntimeRequests()
