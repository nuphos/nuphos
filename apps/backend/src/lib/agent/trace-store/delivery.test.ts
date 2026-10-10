import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { MongoTraceSpan, updateMongoParent } from './span'
import { flushTraceWrites, purgeConversationTraces, serializeTracePayload } from './store'

let release: (() => void) | undefined
let block = false
let failures = 0
const deletes: unknown[] = []
const headers: Record<string, unknown>[] = []

useDb({
  db: () => ({
    collection: (name: string) => ({
      updateOne: async (_filter: unknown, update: { $setOnInsert: Record<string, unknown> }) => {
        if (failures-- > 0) throw new Error('temporary database outage')
        if (block)
          await new Promise<void>((resolve) => {
            release = resolve
          })
        headers.push(update.$setOnInsert)
      },
      deleteMany: (filter: unknown) => {
        deletes.push({ name, filter })

        return Promise.resolve()
      },
    }),
  }),
})

test('flush deadline is bounded and an eventual write can still be drained', async () => {
  block = true
  const span = new MongoTraceSpan({ name: 'slow' })

  await expect(flushTraceWrites(5)).rejects.toThrow('timed out')
  block = false
  release!()
  await flushTraceWrites()
  expect(headers.some((row) => row.spanId === span.context.spanId)).toBe(true)
})

test('root updates retain session ownership and conversation deletion purges both collections', async () => {
  const span = new MongoTraceSpan({
    name: 'conversation',
    metadata: { sessionId: 'session', teamId: 'team' },
  })

  updateMongoParent(span.export(), { metrics: { tokens: 4 } })
  await purgeConversationTraces('session')
  expect(headers.find((row) => row.kind === 'update')).toMatchObject({
    sessionId: 'session',
    teamId: 'team',
  })
  expect(deletes).toEqual([
    { name: 'agent_trace_payloads', filter: { sessionId: 'session' } },
    { name: 'agent_trace_events', filter: { sessionId: 'session' } },
  ])
})

test('cyclic error causes do not drop the entire trace event', () => {
  const error = new Error('cycle')

  error.cause = error
  expect(JSON.parse(serializeTracePayload(error))).toMatchObject({
    message: 'cycle',
    cause: '[Circular]',
  })
})

test('purge runs after its own failed writes and preserves the failure report', async () => {
  failures = 3
  const span = new MongoTraceSpan({
    name: 'failed-purge',
    metadata: { sessionId: 'failed-session' },
  })

  await purgeConversationTraces('failed-session')
  expect(deletes.slice(-2)).toEqual([
    { name: 'agent_trace_payloads', filter: { sessionId: 'failed-session' } },
    { name: 'agent_trace_events', filter: { sessionId: 'failed-session' } },
  ])
  expect(headers.some((row) => row.spanId === span.context.spanId)).toBe(false)
  await expect(flushTraceWrites()).rejects.toThrow('could not be persisted')
})

test('purge does not wait for another session', async () => {
  block = true
  const span = new MongoTraceSpan({ name: 'other', metadata: { sessionId: 'other-session' } })

  try {
    await purgeConversationTraces('target-session')
    expect(headers.some((row) => row.spanId === span.context.spanId)).toBe(false)
    expect(deletes.slice(-1)).toEqual([
      { name: 'agent_trace_events', filter: { sessionId: 'target-session' } },
    ])
  } finally {
    block = false
    release!()
    await flushTraceWrites()
  }
})
