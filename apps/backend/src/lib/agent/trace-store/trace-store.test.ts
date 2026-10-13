import { generateText, Output } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { z } from 'zod'

import { config } from '@/config'
import { useDb } from '@/lib/test/doubles/db'

import {
  aiTelemetry,
  createConversationParent,
  startTraceSpan,
  traced,
  updateConversationParent,
  wrapAI,
} from '../tracing'

import { MongoTraceSpan, traceParent } from './span'
import { flushTraceWrites, serializeTracePayload } from './store'

import type { Binary } from 'mongodb'

const records = new Map<string, Record<string, unknown>>()
let failures = 0

afterEach(async () => {
  await flushTraceWrites()
})

useDb({
  db: () => ({
    collection: (collection: string) => ({
      updateOne: async (
        filter: { _id: string },
        update: { $setOnInsert: Record<string, unknown> },
      ) => {
        if (failures-- > 0) throw new Error('temporary database outage')
        records.set(`${collection}:${filter._id}`, {
          _id: filter._id,
          collection,
          ...update.$setOnInsert,
        })
      },
    }),
  }),
})
beforeEach(() => {
  records.clear()
  failures = 0
})
const events = () => [...records.values()].filter((row) => row.collection === 'agent_trace_events')
const payload = (row: Record<string, unknown>) =>
  JSON.parse(row.payload as string) as Record<string, unknown>

test('Mongo spans survive without OTel, preserve nested parents and updates', async () => {
  const root = await createConversationParent({
    spanId: 'session-1',
    input: 'prompt',
    output: 'answer',
    metadata: { sessionId: 'session-1', teamId: 'team-1' },
  })

  await traced({ name: 'turn', parent: root }, async (turn) => {
    const exported = await turn.export()
    const tool = startTraceSpan({ name: 'tool', parent: exported })
    const data = { text: 'x'.repeat(50_000), '$literal.key': 1 }

    tool.log({ output: data, metrics: { duration_ms: 42 } })
    data.text = 'mutated'
    tool.event('tool.finished', { ok: true })
    tool.end()
    tool.end()
  })
  updateConversationParent(root, { metrics: { total_tokens: 10 } })
  await flushTraceWrites()
  const rows = events()
  const turn = rows.find((row) => row.name === 'turn' && row.kind === 'start')!
  const tool = rows.find((row) => row.name === 'tool' && row.kind === 'start')!

  expect(turn.parentSpanId).toBe('session-1')
  expect(tool.parentSpanId).toBe(turn.spanId)
  expect(tool.rootSpanId).toBe('session-1')
  expect(tool.teamId).toBe('team-1')
  expect(rows.filter((row) => row.name === 'tool' && row.kind === 'end')).toHaveLength(1)
  expect(payload(rows.find((row) => row.name === 'tool' && row.kind === 'log')!).output).toEqual({
    text: 'x'.repeat(50_000),
    '$literal.key': 1,
  })
  expect(payload(rows.find((row) => row.kind === 'update')!)).toEqual({
    metrics: { total_tokens: 10 },
  })
})

test('full payload exceeding BSON document limit is reconstructible and retries are idempotent', async () => {
  const input = { text: '龍'.repeat(6_000_000) }

  failures = 1
  const span = new MongoTraceSpan({ name: 'large', input })

  span.end()
  await flushTraceWrites()
  const row = events().find((event) => event.kind === 'start')!
  const chunks = [...records.values()]
    .filter((record) => record.eventId === row._id)
    .sort((a, b) => Number(a.index) - Number(b.index))

  expect(chunks).toHaveLength(row.chunkCount as number)
  const json = Buffer.concat(
    chunks.map((chunk) => Buffer.from((chunk.data as Binary).buffer)),
  ).toString()

  expect(JSON.parse(json).input).toEqual(input)
  expect(events()).toHaveLength(2)
})

test('errors keep stack and cause; unrecognized parents are ignored', async () => {
  await expect(
    traced({ name: 'failure', parent: 'legacy-export' }, async () => {
      throw new Error('outer', { cause: new Error('inner') })
    }),
  ).rejects.toThrow('outer')
  await flushTraceWrites()
  expect(traceParent('legacy-export')).toBeUndefined()
  const errorRow = events().find((row) => row.kind === 'log')!

  expect(payload(errorRow)).toMatchObject({
    error: { message: 'outer', cause: { message: 'inner' } },
  })
  const shared = { x: 1 }

  expect(JSON.parse(serializeTracePayload({ a: shared, b: shared }))).toEqual({
    a: shared,
    b: shared,
  })
})

const model = () =>
  new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text: '{"answer":"yes"}' }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 4, text: 4, reasoning: 0 },
      },
      warnings: [],
      providerMetadata: { test: { marker: 'retained' } },
      response: {
        id: 'response-1',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        modelId: 'test',
        headers: { secret: 'excluded' },
      },
    }),
  })

test('real AI SDK records resolved provider prompt, structured output, usage and response metadata', async () => {
  const wrapped = wrapAI({ generateText })
  const result = await wrapped.generateText({
    model: model(),
    system: 'system instructions',
    prompt: 'question',
    output: Output.object({ schema: z.object({ answer: z.string() }) }),
    experimental_telemetry: aiTelemetry({
      sessionId: 'sdk-session',
      teamId: 'sdk-team',
      userId: 'sdk-user',
    }),
  })

  expect(result.output).toEqual({ answer: 'yes' })
  await flushTraceWrites()
  const rows = events()

  expect(rows.find((row) => row.name === 'ai.doGenerate' && row.kind === 'start')?.sessionId).toBe(
    'sdk-session',
  )
  const input = payload(
    rows.find((row) => row.name === 'ai.doGenerate' && row.kind === 'start')!,
  ).input

  expect(JSON.stringify(input)).toContain('system instructions')
  const output = payload(
    rows.find((row) => row.name === 'generateText' && row.kind === 'log' && payload(row).output)!,
  ).output

  expect(output).toMatchObject({
    text: '{"answer":"yes"}',
    output: { answer: 'yes' },
    response: { id: 'response-1' },
    totalUsage: { inputTokens: 3, outputTokens: 4 },
  })
  expect(JSON.stringify(rows)).not.toContain('excluded')
})

// Captured from the removed vendor SDK 3.9.0 using this mock provider.
// Keep the fixture as a content-parity contract without retaining the dependency.
test('Mongo preserves the pre-removal generation output contract', async () => {
  const { default: expected } = await import('./fixtures/generate-text.json')

  await wrapAI({ generateText }).generateText({
    model: model(),
    system: 'parity system',
    prompt: 'parity input',
  })
  await flushTraceWrites()
  const nativeCall = events().find(
    (row) => row.name === 'generateText' && row.kind === 'log' && payload(row).output,
  )

  expect(payload(nativeCall!).output).toMatchObject(expected)
  const all = JSON.stringify(events().map(payload))

  for (const marker of ['parity system', 'parity input', 'response-1', 'retained', 'answer'])
    expect(all).toContain(marker)
})

test('native exports preserve ids and ownership across later spans', async () => {
  const span = startTraceSpan({
    name: 'native',
    input: { exact: 'input' },
    metadata: { sessionId: 'same-session' },
  })
  const parent = await span.export()

  expect(parent.startsWith('mongo:')).toBe(true)
  span.log({ output: { exact: 'output' }, metrics: { cost: 1.5 }, metadata: { model: 'test' } })
  new MongoTraceSpan({ name: 'later-child', parent }).end()
  span.end()
  await flushTraceWrites()
  const row = events().find((event) => event.name === 'native' && event.kind === 'log')!

  expect(traceParent(parent)).toMatchObject({ spanId: row.spanId })
  expect(payload(row)).toEqual({
    output: { exact: 'output' },
    metrics: { cost: 1.5 },
    metadata: { model: 'test' },
  })
  expect(events().find((event) => event.name === 'later-child')).toMatchObject({
    parentSpanId: row.spanId,
    sessionId: 'same-session',
  })
})

test('binary values retain every byte in compact base64 form', () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255])
  const snapshot = JSON.parse(serializeTracePayload({ bytes, buffer: Buffer.from(bytes) }))

  for (const field of ['bytes', 'buffer']) {
    expect(snapshot[field].encoding).toBe('base64')
    expect(Buffer.from(snapshot[field].data, 'base64')).toEqual(Buffer.from(bytes))
  }
})

test('retention applies the same expiry to headers and all payload chunks', async () => {
  const original = config.agent.mongoTraceRetentionDays

  try {
    config.agent.mongoTraceRetentionDays = 7
    new MongoTraceSpan({ name: 'retained', input: 'x'.repeat(600_000) }).end()
    await flushTraceWrites()
    const row = events().find((event) => event.kind === 'start')!
    const chunks = [...records.values()].filter((record) => record.eventId === row._id)

    expect((row.expiresAt as Date).getTime() - (row.ts as Date).getTime()).toBe(7 * 86_400_000)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.expiresAt).toEqual(row.expiresAt)
  } finally {
    config.agent.mongoTraceRetentionDays = original
  }
})
