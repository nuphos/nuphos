import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useObservability } from '@/lib/test/doubles/observability'

import { recordRuntimeTurnUsage, writeRuntimeTurnUsage } from './turn-usage-record'

import type { AgentTokenUsageRecord } from './token-usage-db'

const inserted: AgentTokenUsageRecord[] = []
const conversationUpdates: { filter: unknown; update: unknown }[] = []
const failures: string[] = []
let insertError: Error | null = null
let summaryRows: unknown[] = []
let preview: Record<string, unknown> = { runtimeDefaults: { model: 'claude-opus-5' } }

const usageCollection = {
  insertMany: (rows: AgentTokenUsageRecord[]) => {
    if (insertError) throw insertError
    inserted.push(...rows)

    return Promise.resolve({ insertedCount: rows.length })
  },
  aggregate: () => ({ toArray: () => Promise.resolve(summaryRows) }),
}
const conversationCollection = {
  findOne: () => Promise.resolve({ claudeCodePreview: preview }),
  updateOne: (filter: unknown, update: unknown) => {
    conversationUpdates.push({ filter, update })

    return Promise.resolve({ modifiedCount: 1 })
  },
}

useDb({
  db: () => ({
    collection: (name: string) =>
      name === 'agent_token_usage' ? usageCollection : conversationCollection,
  }),
})
useObservability({
  logError: (event) => {
    failures.push(event)
  },
})

beforeEach(() => {
  inserted.length = 0
  conversationUpdates.length = 0
  failures.length = 0
  insertError = null
  summaryRows = []
  preview = { runtimeDefaults: { model: 'claude-opus-5' } }
})

// The recorder is fire-and-forget; one macrotask turn lets its whole chain
// (insert, then summary refresh) settle without waiting on a clock.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const turn = {
  sessionId: 'session-1',
  userId: 'user-1',
  teamId: 'team-1',
  provider: 'claude-code',
  usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
}

test('records a finished turn against its conversation', async () => {
  summaryRows = [
    { totals: [{ recordCount: 3, modelCallCount: 1, toolCallCount: 0 }], providers: [] },
  ]
  await writeRuntimeTurnUsage(turn)

  const byKind = new Map(inserted.map((row) => [row.kind, row]))

  expect([...byKind.keys()].sort((a, b) => a.localeCompare(b))).toEqual([
    'input',
    'output',
    'step_total',
  ])
  expect(byKind.get('step_total')?.tokens).toEqual({
    inputTokens: 1000,
    outputTokens: 200,
    totalTokens: 1200,
  })
  expect(byKind.get('input')?.tokens).toEqual({ inputTokens: 1000 })
  expect(byKind.get('output')?.tokens).toEqual({ outputTokens: 200 })
  for (const row of inserted) {
    expect(row).toMatchObject({
      sessionId: 'session-1',
      userId: 'user-1',
      teamId: 'team-1',
      provider: 'claude-code',
      modelId: 'claude-opus-5',
      operation: 'agent.turn',
      source: 'agent-runtime',
      accounting: 'upstream_reported',
    })
    expect(row.triggerId).toBeUndefined()
  }
  // The conversation's own total is rewritten from what was just written.
  expect(conversationUpdates).toHaveLength(1)
  expect(conversationUpdates[0]?.filter).toMatchObject({
    sessionId: 'session-1',
    userId: 'user-1',
  })
  expect(conversationUpdates[0]?.update).toEqual({ $set: { tokenUsage: expect.any(Object) } })
})

test('attributes a trigger-fired turn to its trigger and fire', async () => {
  await writeRuntimeTurnUsage({
    ...turn,
    trigger: { id: 'trigger-1', kind: 'scheduled', fireId: 'fire-1' },
  })

  expect(inserted.length).toBeGreaterThan(0)
  for (const row of inserted)
    expect(row).toMatchObject({
      triggerId: 'trigger-1',
      triggerKind: 'scheduled',
      triggerFireId: 'fire-1',
    })
})

test('a turn that reports no usage records nothing', async () => {
  await writeRuntimeTurnUsage({ ...turn, usage: {} })

  expect(inserted).toHaveLength(0)
  expect(conversationUpdates).toHaveLength(0)
})

test('a storage failure is logged and never fails the turn', async () => {
  insertError = new Error('synthetic database outage')
  // Not awaited: the point is that its rejection cannot escape.
  recordRuntimeTurnUsage(turn)
  await flush()

  expect(failures).toEqual(['agent.turn_usage.record_failed'])
  expect(conversationUpdates).toHaveLength(0)
})

// PromptResponse.usage as claude-agent-acp 0.74.0 builds it (sessionUsage): `inputTokens` is
// Anthropic's uncached `input_tokens`, and the cache classes travel in their own fields.
test('a Claude Code turn keeps its cache reads and writes in the prompt count', async () => {
  await writeRuntimeTurnUsage({
    ...turn,
    usage: {
      inputTokens: 12,
      outputTokens: 900,
      cachedReadTokens: 250_000,
      cachedWriteTokens: 8000,
      totalTokens: 258_912,
    },
  })

  const byKind = new Map(inserted.map((row) => [row.kind, row]))

  expect(byKind.get('step_total')?.tokens).toEqual({
    inputTokens: 258_012,
    cachedInputTokens: 250_000,
    cacheWriteTokens: 8000,
    outputTokens: 900,
    totalTokens: 258_912,
  })
  expect(byKind.get('input')?.tokens).toEqual({
    inputTokens: 258_012,
    cachedInputTokens: 250_000,
    cacheWriteTokens: 8000,
  })
})

// PromptResponse.usage as codex-acp 1.1.4 builds it (toPromptUsage): uncached input, cache
// reads, and reasoning as `thoughtTokens`, a part of the output count.
test('a Codex turn keeps its cache reads and reasoning tokens', async () => {
  await writeRuntimeTurnUsage({
    ...turn,
    provider: 'codex',
    usage: {
      totalTokens: 43_500,
      inputTokens: 3000,
      cachedReadTokens: 40_000,
      outputTokens: 500,
      thoughtTokens: 200,
    },
  })

  const byKind = new Map(inserted.map((row) => [row.kind, row]))

  expect(byKind.get('step_total')?.tokens).toEqual({
    inputTokens: 43_000,
    cachedInputTokens: 40_000,
    outputTokens: 500,
    reasoningTokens: 200,
    totalTokens: 43_500,
  })
  expect(byKind.get('thinking')?.tokens).toEqual({ reasoningTokens: 200 })
})

// gemini-cli's ACP usage (acpSession.ts): `inputTokens` is the whole prompt, cache reads
// included, and the total is input plus output.
test('a Gemini turn does not count its cache reads twice', async () => {
  await writeRuntimeTurnUsage({
    ...turn,
    provider: 'gemini',
    usage: {
      inputTokens: 100_000,
      cachedReadTokens: 80_000,
      outputTokens: 2000,
      totalTokens: 102_000,
    },
  })

  expect(inserted.find((row) => row.kind === 'step_total')?.tokens).toEqual({
    inputTokens: 100_000,
    cachedInputTokens: 80_000,
    outputTokens: 2000,
    totalTokens: 102_000,
  })
})

// `_meta.quota` as claude-agent-acp 0.74.0 builds it (turnQuotaMeta): the model rows also
// count a Task sub-agent on another model, which the main-loop `usage` leaves out.
test("a Claude Code turn's quota records each model it used, sub-agents included", async () => {
  await writeRuntimeTurnUsage({
    ...turn,
    usage: { inputTokens: 12, outputTokens: 900, cachedReadTokens: 250_000, totalTokens: 250_912 },
    quota: {
      token_count: { totalTokens: 250_912 },
      model_usage: [
        {
          model: 'claude-opus-5-5',
          token_count: {
            totalTokens: 250_912,
            inputTokens: 12,
            cachedInputTokens: 250_000,
            cachedWriteTokens: 0,
            outputTokens: 900,
            reasoningOutputTokens: 0,
          },
        },
        {
          model: 'claude-haiku-5-5',
          token_count: {
            totalTokens: 31_400,
            inputTokens: 400,
            cachedInputTokens: 30_000,
            cachedWriteTokens: 600,
            outputTokens: 400,
            reasoningOutputTokens: 0,
          },
        },
      ],
    },
  })

  const totals = inserted
    .filter((row) => row.kind === 'step_total')
    .map((row) => [row.modelId, row.tokens])

  expect(totals).toEqual([
    [
      'claude-opus-5-5',
      {
        inputTokens: 250_012,
        cachedInputTokens: 250_000,
        cacheWriteTokens: 0,
        outputTokens: 900,
        totalTokens: 250_912,
      },
    ],
    [
      'claude-haiku-5-5',
      {
        inputTokens: 31_000,
        cachedInputTokens: 30_000,
        cacheWriteTokens: 600,
        outputTokens: 400,
        totalTokens: 31_400,
      },
    ],
  ])
  expect(inserted.some((row) => row.kind === 'thinking')).toBe(false)
})

test('a turn without model rows falls back to its usage and the picked model', async () => {
  await writeRuntimeTurnUsage({ ...turn, quota: { token_count: {}, model_usage: [] } })

  expect(inserted.find((row) => row.kind === 'step_total')?.modelId).toBe('claude-opus-5')
})

// Claude Code's picker offers aliases; each names its model in the label the runtime gave it.
const picker = (currentValue: string) => ({
  sessionConfig: [
    {
      id: 'model',
      name: 'Model',
      kind: 'model',
      currentValue,
      options: [
        { value: 'default', name: 'Default (recommended)', description: 'Opus 5.5' },
        { value: 'opus', name: 'Opus 5.5', description: 'For complex work and everyday tasks' },
        { value: 'sonnet', name: 'Sonnet 5.5', description: 'Most efficient for simpler tasks' },
        { value: 'claude-opus-5', name: 'Opus 5', description: 'Best for everyday tasks' },
        { value: 'opencode/big-pickle', name: 'Big Pickle' },
      ],
    },
  ],
})

test('a picked alias records the model its picker names, not the alias', async () => {
  const picked = async (value: string) => {
    inserted.length = 0
    preview = picker(value)
    await writeRuntimeTurnUsage(turn)

    return inserted.find((row) => row.kind === 'step_total')?.modelId
  }

  expect(await picked('default')).toBe('claude-opus-5-5')
  expect(await picked('opus')).toBe('claude-opus-5-5')
  expect(await picked('sonnet')).toBe('claude-sonnet-5-5')
  expect(await picked('claude-opus-5')).toBe('claude-opus-5')
  // Another runtime's model id is kept as picked.
  expect(await picked('opencode/big-pickle')).toBe('opencode/big-pickle')
  // A default whose label names no model is unknown, never "default".
  preview = { runtimeDefaults: { model: 'default' } }
  inserted.length = 0
  await writeRuntimeTurnUsage(turn)
  expect(inserted.find((row) => row.kind === 'step_total')?.modelId).toBe('unknown')
})

test('a quota whose models report nothing countable falls back to its usage', async () => {
  await writeRuntimeTurnUsage({
    ...turn,
    quota: { token_count: {}, model_usage: [{ model: 'claude-haiku-5', token_count: {} }] },
  })

  expect(inserted.find((row) => row.kind === 'step_total')?.modelId).toBe('claude-opus-5')
})

test('every row of a turn names who sent it, from where, on which runtime and computer', async () => {
  await writeRuntimeTurnUsage({
    ...turn,
    stopReason: 'cancelled',
    actorUserId: 'teammate-2',
    turnSource: 'slack.agent',
    runtimeId: 'runtime-7',
    deviceId: 'mac-1',
  })

  expect(inserted.length).toBeGreaterThan(1)
  for (const row of inserted)
    expect(row).toMatchObject({
      userId: 'user-1',
      actorUserId: 'teammate-2',
      turnSource: 'slack.agent',
      runtimeId: 'runtime-7',
      deviceId: 'mac-1',
      finishReason: 'cancelled',
    })
})
