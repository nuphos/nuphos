import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { MongoTraceSpan, updateMongoParent } from './span'
import { flushTraceWrites, purgeConversationTraces, serializeTracePayload } from './store'

let release: (() => void) | undefined
let block = false
const deletes: unknown[] = []
const headers: Record<string, unknown>[] = []

useDb({
  db: () => ({
    collection: (name: string) => ({
      updateOne: async (_filter: unknown, update: { $setOnInsert: Record<string, unknown> }) => {
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
