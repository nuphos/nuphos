import { describe, expect, test } from 'bun:test'

import { BACKGROUND_WORK_LOST_NOTICE, BACKGROUND_WORK_UNCERTAIN_NOTICE } from './background-work'
import { OpenAbConnectionLostError, OpenAbRpcError } from './openab-acp-errors'
import {
  INTERRUPTED_TOOL_ERROR,
  classifyPreviewInterruption,
  interruptToolSteps,
} from './preview-transcript'

import type { UIMessage } from 'ai'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

const SENDER = {
  version: 1 as const,
  sender: { type: 'user' as const, id: 'u-ada', displayName: 'Ada' },
  source: 'nuphos' as const,
  sentAt: '2026-09-29T00:00:00.000Z',
}

useAgentDb({
  getCompactionSummary: () =>
    Promise.resolve({ summary: 'Earlier: set up the cluster.', messageCount: 8 }),
})

const {
  createPreviewAssistantPartAccumulator,
  previewAssistantMessageParts,
  previewCompactionSummary,
} = await import('./preview-transcript')
const { previewHistoryPreamble } = await import('./preview-history-preamble')

describe('previewAssistantMessageParts', () => {
  test('preserves commentary around tool calls instead of joining it into the final answer', () => {
    const ordered = createPreviewAssistantPartAccumulator()

    ordered.appendText('I will inspect the rules. ')
    ordered.appendTool('tc-1')
    ordered.appendText('The database is private. ')
    ordered.appendTool('tc-2')
    ordered.appendText('Found 361 suspicious reads.')

    expect(
      ordered.materialize([
        { toolCallId: 'tc-1', toolName: 'Read', input: {}, output: 'rules' },
        { toolCallId: 'tc-2', toolName: 'Bash', input: {}, output: '361' },
      ]) as unknown,
    ).toEqual([
      { type: 'text', text: 'I will inspect the rules. ' },
      {
        type: 'tool-Read',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: {},
        output: 'rules',
      },
      { type: 'text', text: 'The database is private. ' },
      {
        type: 'tool-Bash',
        toolCallId: 'tc-2',
        state: 'output-available',
        input: {},
        output: '361',
      },
      { type: 'text', text: 'Found 361 suspicious reads.' },
    ])
  })

  test('persists reasoning, tool steps, and text in the classic part shapes', () => {
    const parts = previewAssistantMessageParts({
      reasoning: 'thinking',
      text: 'done',
      toolSteps: [
        { toolCallId: 'tc-1', toolName: 'Bash', input: { command: 'ls' }, output: 'a\nb' },
        { toolCallId: 'tc-2', toolName: 'Read', input: { path: 'x' }, errorText: 'nope' },
        { toolCallId: 'tc-3', toolName: 'Grep', input: { q: 'y' } },
      ],
    })

    expect(parts).toEqual([
      { type: 'reasoning', text: 'thinking' },
      {
        type: 'tool-Bash',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: { command: 'ls' },
        output: 'a\nb',
      },
      {
        type: 'tool-Read',
        toolCallId: 'tc-2',
        state: 'output-error',
        input: { path: 'x' },
        errorText: 'nope',
      },
      { type: 'tool-Grep', toolCallId: 'tc-3', state: 'input-available', input: { q: 'y' } },
      { type: 'text', text: 'done' },
    ])
  })

  test('persists sub-agent attribution on the step that carries it', () => {
    const parts = previewAssistantMessageParts({
      reasoning: '',
      text: '',
      toolSteps: [
        {
          toolCallId: 'task-1',
          toolName: 'Agent',
          input: { description: 'find the flag' },
          subagent: true,
        },
        {
          toolCallId: 'child-1',
          toolName: 'Read',
          input: { path: 'flag.ts' },
          parentToolUseId: 'task-1',
        },
        { toolCallId: 'child-2', toolName: 'Grep', input: { q: 'flag' } },
      ],
    })

    expect(parts as unknown).toEqual([
      {
        type: 'tool-Agent',
        toolCallId: 'task-1',
        state: 'input-available',
        input: { description: 'find the flag' },
        subagent: true,
      },
      {
        type: 'tool-Read',
        toolCallId: 'child-1',
        state: 'input-available',
        input: { path: 'flag.ts' },
        parentToolUseId: 'task-1',
      },
      { type: 'tool-Grep', toolCallId: 'child-2', state: 'input-available', input: { q: 'flag' } },
    ])
  })

  test('omits empty reasoning and text', () => {
    expect(previewAssistantMessageParts({ reasoning: '', text: '', toolSteps: [] })).toEqual([])
  })

  test('keeps tool timing metadata when materializing the durable turn', () => {
    const ordered = createPreviewAssistantPartAccumulator()

    ordered.appendTool('tc-1')
    const parts: unknown = ordered.materialize([
      {
        toolCallId: 'tc-1',
        toolName: 'Terminal',
        input: { command: 'echo ok' },
        output: 'ok',
        startedAt: 1_000,
        completedAt: 4_250,
      },
    ])

    expect(parts).toEqual([
      {
        type: 'tool-Terminal',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: { command: 'echo ok' },
        output: 'ok',
        startedAt: 1_000,
        completedAt: 4_250,
      },
    ])
  })
})

describe('previewHistoryPreamble', () => {
  const messages = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'How many LKE clusters?' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'tool-Bash', toolCallId: 't', state: 'output-available', input: { command: 'x' } },
        { type: 'text', text: 'You have 9.' },
      ],
    },
    { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Delete the expired ones' }] },
  ] as unknown as UIMessage[]

  test('renders earlier turns (not the current one) after the compaction summary', () => {
    const preamble = previewHistoryPreamble(messages, 'Earlier: set up the cluster.')

    expect(preamble).toContain('Summary of earlier turns:\nEarlier: set up the cluster.')
    expect(preamble).toContain('User: How many LKE clusters?')
    expect(preamble).toContain('[tool Bash {"command":"x"}]\nYou have 9.')
    expect(preamble).not.toContain('Delete the expired ones')
  })

  test('tells the agent the previous process took its background work with it', () => {
    // The silent death is the bug: a monitor armed before the respawn never
    // reports, so the only chance to say so is the first prompt afterwards.
    expect(previewHistoryPreamble(messages)).toContain(BACKGROUND_WORK_LOST_NOTICE)
  })

  test('says only that contact was lost when that is all Nuphos knows', () => {
    // Telling the agent the work is certainly dead would invite it to re-run
    // a command that may have already had its effect.
    const preamble = previewHistoryPreamble(messages, null, true)

    expect(preamble).toContain(BACKGROUND_WORK_UNCERTAIN_NOTICE)
    expect(preamble).not.toContain(BACKGROUND_WORK_LOST_NOTICE)
  })

  test('is null for a brand-new conversation', () => {
    expect(previewHistoryPreamble([messages[0]!])).toBeNull()
  })

  test('carries a long conversation far past the twelve turns it used to stop at', () => {
    // A move or an import makes this preamble the only carrier of the
    // conversation, so a fixed turn count silently dropped the investigation
    // that led to the current question.
    const long = Array.from({ length: 60 }, (_, index) => ({
      id: `m${String(index)}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      parts: [{ type: 'text', text: `turn ${String(index)}` }],
    })) as unknown as UIMessage[]
    const preamble = previewHistoryPreamble(long)

    expect(preamble).toContain('turn 0')
    expect(preamble).toContain('turn 30')
    expect(preamble).toContain('turn 58')
  })

  test('drops the oldest turns once the budget is spent, never the newest', () => {
    // 30 turns of 40 KB overrun the 120 KB budget, so only the newest fit. The
    // last message is the current input, not history.
    const heavy = Array.from({ length: 30 }, (_, index) => ({
      id: `h${String(index)}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      parts: [{ type: 'text', text: `mark${String(index)} ${'x'.repeat(40_000)}` }],
    })) as unknown as UIMessage[]
    const preamble = previewHistoryPreamble(heavy)

    expect(preamble).toContain('mark28')
    expect(preamble).not.toContain('mark0 ')
    expect(preamble?.length).toBeLessThan(130_000)
  })

  test('keeps the end of a long turn: its late correction and final answer', () => {
    const preamble = previewHistoryPreamble([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Fix the deploy.' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: `progress ${'x'.repeat(20_000)}` },
          { type: 'data-steering', data: { text: 'Use staging, not prod.' } },
          { type: 'text', text: 'Done: staging is deployed.' },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Thanks' }] },
    ] as unknown as UIMessage[])

    expect(preamble).toContain('Fix the deploy.')
    expect(preamble).toContain('Use staging, not prod.')
    expect(preamble).toContain('Done: staging is deployed.')
    expect(preamble).not.toContain('Earlier turns are omitted')
  })

  test('cuts a single turn larger than the whole budget from its start, and says so', () => {
    const preamble = previewHistoryPreamble([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'first question' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: `early ${'x'.repeat(200_000)} final answer` }],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'next' }] },
    ] as unknown as UIMessage[])

    expect(preamble).toContain('final answer')
    expect(preamble).not.toContain('early ')
    expect(preamble).not.toContain('first question')
    expect(preamble).toContain('Earlier turns are omitted')
    expect(preamble?.length).toBeLessThan(125_000)
  })

  test('previewCompactionSummary reads the stored summary text', async () => {
    expect(await previewCompactionSummary('s', 'u')).toBe('Earlier: set up the cluster.')
  })
})

describe('interrupted preview turns', () => {
  test('explains disk exhaustion and still gives an explicit user stop precedence', () => {
    for (const error of ['ENOSPC: write failed', 'No space left on device']) {
      expect(classifyPreviewInterruption(new Error(error), false)).toEqual({
        reason: 'error',
        message:
          'The agent’s runtime is out of disk space, so it could not run this turn. Free up disk space on the runtime or switch this conversation to another runtime, then resend your message.',
      })
      expect(classifyPreviewInterruption(new Error(error), true).reason).toBe('cancelled')
    }
  })
  test('classifies the cause from the abort flag and error text', () => {
    const cancelled = classifyPreviewInterruption(
      new Error('OpenAB ACP session/prompt cancelled'),
      false,
    )

    expect(cancelled.reason).toBe('cancelled')
    expect(cancelled.message).not.toContain('OpenAB')
    expect(classifyPreviewInterruption(new Error('anything'), true).reason).toBe('cancelled')
    expect(
      classifyPreviewInterruption(new Error('Timed out waiting for agent backend'), false).reason,
    ).toBe('timeout')
    expect(
      classifyPreviewInterruption(
        new Error('OpenAB ACP session/prompt timed out: no turn progress for 1920s'),
        false,
      ),
    ).toEqual({
      reason: 'timeout',
      message: 'The agent stopped making progress, so the turn was stopped.',
    })
    const failed = classifyPreviewInterruption(
      new Error('ACP session output sink is unavailable'),
      false,
    )

    expect(failed.reason).toBe('error')
    expect(failed.message).not.toContain('ACP')
  })
  test('names a lost runtime connection and its reason instead of a generic failure', () => {
    expect(
      classifyPreviewInterruption(
        new OpenAbConnectionLostError('The computer running this agent is offline'),
        false,
      ),
    ).toEqual({
      reason: 'error',
      message:
        'Lost the connection to the agent runtime: The computer running this agent is offline.',
    })
    expect(classifyPreviewInterruption(new OpenAbConnectionLostError(), false).message).toBe(
      'Lost the connection to the agent runtime.',
    )
  })

  test('marks steps that never produced output as interrupted', () => {
    const steps = interruptToolSteps([
      { toolCallId: 'a', toolName: 'Bash', input: {}, output: 'ok' },
      { toolCallId: 'b', toolName: 'Bash', input: {} },
      { toolCallId: 'c', toolName: 'Bash', input: {}, errorText: 'boom' },
    ])

    expect(steps.map((s) => s.errorText)).toEqual([undefined, INTERRUPTED_TOOL_ERROR, 'boom'])
  })
})

test('native steering keeps its place, takes its sender later, and unfinished tools keep their final output', () => {
  const parts = createPreviewAssistantPartAccumulator()

  parts.appendText('Working')
  parts.appendTool('running')
  parts.appendSteering({ id: 'receipt', text: 'Focus on tests' })
  parts.appendSteering({ id: 'receipt', text: 'Focus on tests', metadata: SENDER })
  parts.appendText('Adjusted')
  const result = parts.materialize([
    { toolCallId: 'running', toolName: 'bash', input: {}, output: 'done' },
  ])

  expect(result.map((p) => p.type)).toEqual(['text', 'tool-bash', 'data-steering', 'text'])
  expect(result[2]).toMatchObject({
    type: 'data-steering',
    data: { id: 'receipt', text: 'Focus on tests', metadata: SENDER },
  })
  expect(result[1]).toMatchObject({ output: 'done' })
})

test('fresh runtime history retains accepted mid-turn user instructions', () => {
  const messages = [
    {
      id: 'a',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Inspecting production' },
        { type: 'data-steering', data: { id: 's', text: 'Only inspect staging' } },
        {
          type: 'data-steering',
          data: { id: 's2', text: 'And skip the cache', metadata: SENDER },
        },
        { type: 'text', text: 'Inspecting staging instead' },
      ],
    },
    { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Continue' }] },
  ] as UIMessage[]
  const history = previewHistoryPreamble(messages)

  expect(history).toContain('Sent during this turn:\nOnly inspect staging')
  expect(history).toMatch(
    /Sent during this turn:\n<nuphos_message_metadata>\n.*"displayName":"Ada".*\n<\/nuphos_message_metadata>\n\nAnd skip the cache/u,
  )
  expect(history).toContain('Assistant continues:')
})

test('history carries author envelopes and excludes all pending turn inputs', () => {
  const metadata = {
    version: 1,
    sender: { type: 'user', id: 'u1', displayName: 'Yuan' },
    source: 'nuphos',
    sentAt: '2026-09-27T10:00:00Z',
  }
  const messages = [
    { id: 'old', role: 'user', metadata, parts: [{ type: 'text', text: 'old request' }] },
    { id: 'reply', role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
    { id: 'queued', role: 'user', metadata, parts: [{ type: 'text', text: 'queued request' }] },
    { id: 'new', role: 'user', metadata, parts: [{ type: 'text', text: 'new request' }] },
  ] as UIMessage[]
  const text = previewHistoryPreamble(messages, null, false, 2)

  expect(text).toContain('"messageId":"old"')
  expect(text).toContain('old request')
  expect(text).not.toContain('queued request')
  expect(text).not.toContain('new request')
})

test('a provider out of usage keeps its reason in the transcript', () => {
  const refusal = new Error(
    '**Internal Error** (code: -32603)\nInternal error\n> API error (status 402 Payment Required): Grok Build usage balance exhausted requestId=r1',
  )

  expect(classifyPreviewInterruption(new Error('Turn failed', { cause: refusal }), false)).toEqual({
    reason: 'error',
    message:
      'This agent’s provider account has no usage left (Grok Build usage balance exhausted). Add credits or wait for its allowance to reset, or switch to another agent, then resend your message.',
    cause: 'usage_limit',
  })
})

test('a signed-out runtime keeps the sign-in action in the transcript', () => {
  const refusal = new OpenAbRpcError(
    '**Server Error** (code: -32000)\nAuthentication required',
    -32603,
  )

  expect(classifyPreviewInterruption(refusal, false)).toEqual({
    reason: 'error',
    message:
      'This agent’s sign-in is no longer valid, so it could not start the turn. Sign the agent in again, then resend your message.',
    cause: 'auth',
  })
  // A turn someone stopped has no cause to fix.
  expect(classifyPreviewInterruption(refusal, true)).toEqual({
    reason: 'cancelled',
    message: 'The turn was stopped before the agent finished.',
  })
})
