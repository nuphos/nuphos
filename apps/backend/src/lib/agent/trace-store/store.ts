import { randomUUID } from 'node:crypto'

import { Binary } from 'mongodb'

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
const pending = new Set<Promise<void>>()
let failedWrites = 0

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
      if (item instanceof Uint8Array) return { type: 'Buffer', data: [...item] }

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
}

export function writeTraceEvent(event: TraceEvent, payload: unknown): void {
  let json: string

  try {
    json = serializeTracePayload(payload)
  } catch (error) {
    failedWrites++
    logError('agent.trace.serialize_failed', error, { span_id: event.spanId })

    return
  }
  const id = randomUUID()
  const ts = new Date()
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
          payloadBytes: bytes.length,
          ...(chunkCount > 1 ? { chunkCount } : { payload: json }),
        },
      },
      { upsert: true, writeConcern: { w: 'majority', wtimeoutMS: 5_000 }, maxTimeMS: 5_000 },
    )
  }
  const task = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await write()

        return
      } catch (error) {
        if (attempt === 2) {
          failedWrites++
          logError('agent.trace.write_failed', error, { span_id: event.spanId, event_id: id })
        } else {
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt))
        }
      }
    }
  })()

  pending.add(task)
  void task.finally(() => pending.delete(task))
}

export async function flushTraceWrites(timeoutMs = 10_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const drain = async () => {
    while (pending.size) await Promise.all(pending)
  }

  try {
    await Promise.race([
      drain(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(`Mongo trace flush timed out with ${String(pending.size)} pending writes`),
          )
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
  if (failedWrites) {
    const count = failedWrites

    failedWrites = 0
    throw new Error(`${String(count)} Mongo trace events could not be persisted`)
  }
}

export async function purgeConversationTraces(sessionId: string): Promise<void> {
  await flushTraceWrites()
  await db().collection('agent_trace_payloads').deleteMany({ sessionId })
  await db().collection('agent_trace_events').deleteMany({ sessionId })
}
