import { randomUUID } from 'node:crypto'

import { Binary } from 'mongodb'

import { config } from '@/config'
import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { Document } from 'mongodb'

export type TraceEvent = {
  spanId: string
  rootSpanId: string
  parentSpanId?: string
  name?: string
  type?: string
  sessionId?: string
  teamId?: string
  userId?: string
  sequence: number
  kind: 'start' | 'log' | 'event' | 'end' | 'update'
}

const CHUNK_BYTES = 512 * 1024
const inFlight = new Map<Promise<void>, string | undefined>()

// Snapshot at log-time, before callers can mutate an input/result. JSON is
// stored as data, never as Mongo field paths ($ and dots remain literal).
export function serializeTracePayload(value: unknown): string {
  const ancestors: object[] = []
  const errors = new WeakMap<Error, Record<string, unknown>>()

  return (
    JSON.stringify(value, function (key, item: unknown) {
      if (typeof item === 'bigint') return item.toString()
      if (typeof item === 'function') return '[Function]'
      if (!item || typeof item !== 'object') return item
      if (item instanceof Error) {
        const error = item

        item = errors.get(error) ?? {
          name: error.name,
          message: error.message,
          stack: error.stack,
          cause: error.cause,
        }
        errors.set(error, item as Record<string, unknown>)
      }
      while (ancestors.length && ancestors.at(-1) !== this) ancestors.pop()
      if (ancestors.includes(item as object)) return '[Circular]'
      ancestors.push(item as object)
      // Buffer.toJSON runs before the replacer; inspect the original value.
      const original = (this as Record<string, unknown>)[key]

      if (original instanceof Uint8Array) {
        return {
          type: 'Buffer',
          encoding: 'base64',
          data: Buffer.from(original).toString('base64'),
        }
      }

      return item
    }) ?? 'null'
  )
}

export async function setupTraceIndexes(): Promise<void> {
  const events = db().collection<Document & { _id: string }>('agent_trace_events')

  await events.createIndex({ sessionId: 1, ts: 1 })
  await events.createIndex({ rootSpanId: 1, ts: 1 })
  await events.createIndex({ spanId: 1, ts: 1, sequence: 1 })
  await events.createIndex({ teamId: 1, ts: -1 })
  await db().collection('agent_trace_payloads').createIndex({ sessionId: 1 })
  await events.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await db()
    .collection('agent_trace_payloads')
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

export function writeTraceEvent(event: TraceEvent, payload: unknown): void {
  try {
    const ts = new Date()
    const retentionDays = config.agent.mongoTraceRetentionDays
    const header = {
      ...event,
      ts,
      ...(retentionDays > 0
        ? { expiresAt: new Date(ts.getTime() + retentionDays * 86_400_000) }
        : {}),
    }
    const json = serializeTracePayload(payload)
    const pending = deliverTrace(header, randomUUID(), json)
      .catch((error: unknown) => {
        logError('agent.trace.write_failed', error, { span_id: event.spanId })
      })
      .finally(() => {
        inFlight.delete(pending)
      })

    inFlight.set(pending, event.sessionId)
  } catch (error) {
    logError('agent.trace.write_failed', error, { span_id: event.spanId })
  }
}

async function deliverTrace(
  event: TraceEvent & { ts: Date; expiresAt?: Date },
  id: string,
  json: string,
): Promise<void> {
  const { ts } = event
  const expiry = event.expiresAt ? { expiresAt: event.expiresAt } : {}
  const write = async () => {
    const bytes = Buffer.from(json)
    const chunkCount = Math.ceil(bytes.length / CHUNK_BYTES)
    const events = db().collection<Document & { _id: string }>('agent_trace_events')

    if (chunkCount > 1) {
      const chunks = db().collection<Document & { _id: string }>('agent_trace_payloads')

      for (let index = 0; index < chunkCount; index++) {
        await chunks.updateOne(
          { _id: `${id}:${String(index)}` },
          {
            $setOnInsert: {
              eventId: id,
              ts,
              ...expiry,
              sessionId: event.sessionId,
              index,
              data: new Binary(bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)),
            },
          },
          { upsert: true, writeConcern: { w: 'majority', wtimeoutMS: 5_000 }, maxTimeMS: 5_000 },
        )
      }
    }
    // Publish only after all payload chunks have been acknowledged. Retry
    // uses the same ids so a lost acknowledgement cannot duplicate events.
    await events.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          ...event,
          ts,
          ...expiry,
          payloadBytes: bytes.length,
          ...(chunkCount > 1 ? { chunkCount } : { payload: json }),
        },
      },
      { upsert: true, writeConcern: { w: 'majority', wtimeoutMS: 5_000 }, maxTimeMS: 5_000 },
    )
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await write()

      return
    } catch (error) {
      if (attempt === 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt))
    }
  }
}

async function waitForWrites(writes: Promise<void>[], timeoutMs: number): Promise<void> {
  if (!writes.length) return
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      Promise.all(writes),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Mongo trace writes timed out'))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function flushTraceWrites(timeoutMs = 10_000): Promise<void> {
  await waitForWrites([...inFlight.keys()], timeoutMs)
}

export async function purgeConversationTraces(sessionId: string): Promise<void> {
  // Stop writers before calling this helper. Never report a successful purge
  // while an existing local write could still recreate the deleted records.
  await waitForWrites(
    [...inFlight].filter(([, session]) => session === sessionId).map(([write]) => write),
    5_000,
  )
  await Promise.all([
    db().collection('agent_trace_payloads').deleteMany({ sessionId }),
    db().collection('agent_trace_events').deleteMany({ sessionId }),
  ])
}
