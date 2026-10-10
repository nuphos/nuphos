// A steered turn persists as interleaved segments: request messages, then
// assistant / user / assistant in the order the exchange actually happened.
// Enter the routes/agent module graph through its barrel first, so the
// constants ↔ run-pump-helpers cycle initializes in production order.
import '@/routes/agent'

import { describe, expect, test } from 'bun:test'

import type { AgentRun } from './types'
import type { UIMessage } from 'ai'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentPlans } from '@/lib/test/doubles/agent-plans'
import { useTitleGenerator } from '@/lib/test/doubles/title-generator'

const persisted: { messages: { id: string; role: string; parts: unknown[] }[] }[] = []
const storedAt = new Date('2026-10-09T04:00:00.000Z')
let createdPlans: unknown[] = []
let titleGate: Promise<void> = Promise.resolve()

useAgentDb({
  syncConversationTranscript: (args) => {
    persisted.push({ messages: args.messages })

    return Promise.resolve(null)
  },
  getConversationMessagesHead: async () =>
    persisted.at(-1)!.messages.map((message) => ({
      ...message,
      messageId: message.id,
      createdAt: message.id === 'old-answer' ? new Date('2026-10-08T04:00:00.000Z') : storedAt,
    })),
  getConversation: async () => {
    await titleGate

    return { title: 'kept' }
  },
})
useTitleGenerator({
  generateConversationTitle: () => Promise.resolve('t'),
})
useAgentPlans({
  listPlansCreatedForConversation: async () => createdPlans,
})

const { finishPreviewTurn, persistInterruptedPreviewTurn } = await import('./chat-preview-finish')

describe('finishPreviewTurn with steering segments', () => {
  test('persists assistant/user/assistant in exchange order', async () => {
    createdPlans = []
    const frames: Record<string, unknown>[] = []
    const steered: UIMessage[] = [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'answer 1' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: '改查 staging' }] },
    ]

    await finishPreviewTurn({
      run: { trace: undefined } as unknown as AgentRun,
      sessionId: 's1',
      teamId: 't1',
      userId: 'u1',
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'start' }] }],
      firstMessage: 'start',
      locale: 'en-US',
      provider: 'test',
      requestId: 'r1',
      startedAt: 0,
      text: 'answer 2',
      answer: 'answer 1\n\nanswer 2',
      reasoning: '',
      toolSteps: [],
      finalStepStart: 0,
      steered,
      memory: null,
      emit: (frame) => {
        frames.push(frame)
      },
    })

    const roles = persisted[0]!.messages.map((message) => message.role)

    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(frames.find((frame) => frame.type === 'atlas-transcript-snapshot')?.messages).toEqual(
      persisted[0]!.messages.map((message) => ({
        ...message,
        createdAt: storedAt.toISOString(),
      })),
    )
    expect(JSON.stringify(persisted[0]!.messages.at(-1))).toContain('answer 2')
    expect(JSON.stringify(persisted[0]!.messages[2])).toContain('改查 staging')
  })

  test('persists a native Plan card even though its script ran outside MCP', async () => {
    createdPlans = [
      {
        id: '404',
        title: 'Build staging',
        overview: 'Create the staging resources.',
        status: 'proposed',
      },
    ]

    await finishPreviewTurn({
      run: { trace: undefined } as unknown as AgentRun,
      sessionId: 's2',
      teamId: 't1',
      userId: 'u1',
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'build it' }] }],
      firstMessage: 'build it',
      locale: 'en-US',
      provider: 'test',
      requestId: 'r2',
      startedAt: 1,
      text: 'Review the risk before approval.',
      answer: 'Review the risk before approval.',
      reasoning: '',
      toolSteps: [],
      finalStepStart: 0,
      steered: [],
      memory: null,
      emit: () => {},
    })

    const final = JSON.stringify(persisted.at(-1)?.messages.at(-1))

    expect(final).toContain('plan_create')
    expect(final).toContain('404')
  })
})

test('title enrichment cannot keep a completed runtime turn open', async () => {
  let release!: () => void

  titleGate = new Promise<void>((resolve) => {
    release = resolve
  })
  const events: string[] = []
  const finishing = finishPreviewTurn({
    run: { trace: undefined } as unknown as AgentRun,
    sessionId: 'slow-title',
    teamId: 'team',
    userId: 'owner',
    messages: [],
    firstMessage: 'start',
    locale: 'en-US',
    provider: 'test',
    requestId: 'request',
    startedAt: 0,
    text: 'Done',
    answer: 'Done',
    reasoning: '',
    toolSteps: [],
    finalStepStart: 0,
    steered: [],
    memory: null,
    emit: (frame) => {
      events.push(String(frame.type))
    },
    onRuntimeComplete: () => {
      events.push('runtime-complete')
    },
  })
  let finished = false

  void finishing.then(() => {
    finished = true
  })
  await Bun.sleep(0)
  expect(events).toEqual(['atlas-transcript-snapshot', 'runtime-complete'])
  expect(finished).toBe(false)
  release()
  await finishing
  titleGate = Promise.resolve()
})

for (const interrupted of [false, true]) {
  test(`snapshot keeps stored timestamps for historical and ${interrupted ? 'interrupted' : 'completed'} replies`, async () => {
    createdPlans = []
    const frames: Record<string, unknown>[] = []
    const args = {
      run: {
        trace: undefined,
        streamId: 'stream',
        abortController: new AbortController(),
      } as unknown as AgentRun,
      sessionId: 'timestamps',
      teamId: 'team',
      userId: 'owner',
      messages: [
        {
          id: 'old-answer',
          role: 'assistant' as const,
          parts: [{ type: 'text' as const, text: 'Earlier files' }],
        },
      ],
      firstMessage: 'start',
      locale: 'en-US',
      provider: 'test',
      requestId: 'request',
      startedAt: 0,
      text: 'New files',
      answer: 'New files',
      reasoning: '',
      toolSteps: [],
      finalStepStart: 0,
      steered: [],
      memory: null,
      error: new Error('interrupted'),
      emit: (frame: Record<string, unknown>) => {
        frames.push(frame)
      },
    }

    if (interrupted) await persistInterruptedPreviewTurn(args)
    else await finishPreviewTurn(args)

    const snapshot = frames.find((frame) => frame.type === 'atlas-transcript-snapshot')
      ?.messages as { id: string; createdAt: string }[]

    expect(snapshot).toHaveLength(2)
    expect(snapshot[0]).toMatchObject({ id: 'old-answer', createdAt: '2026-10-08T04:00:00.000Z' })
    expect(snapshot[1]!.createdAt).toBe(storedAt.toISOString())
  })
}

test('a completed turn without text or tools persists no assistant message', async () => {
  createdPlans = []
  await finishPreviewTurn({
    run: { trace: undefined } as unknown as AgentRun,
    sessionId: 'empty',
    teamId: 'team',
    userId: 'owner',
    messages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'start' }] }],
    firstMessage: 'start',
    locale: 'en-US',
    provider: 'test',
    requestId: 'empty-run',
    startedAt: 0,
    text: '',
    answer: '',
    reasoning: '',
    orderedParts: [],
    toolSteps: [],
    finalStepStart: 0,
    steered: [],
    memory: null,
    emit: () => {},
  })
  expect(persisted.at(-1)!.messages).toEqual([
    { id: 'question', role: 'user', parts: [{ type: 'text', text: 'start' }] },
  ])
})
