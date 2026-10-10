import { randomUUID } from 'node:crypto'

import { Binary } from 'mongodb'

import { config } from '@/config'
import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import { TraceSpool } from './spool'

import type { QueuedTrace } from './spool'
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
let spool: TraceSpool | undefined
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
  if (!config.agent.mongoTraceSpoolPath) return
  getSpool()
  void flushTraceWrites().catch((error: unknown) => {
    logError('agent.trace.replay_failed', error)
  })
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

function getSpool(): TraceSpool | undefined {
  const path = config.agent.mongoTraceSpoolPath

  if (!path) return undefined
  spool ??= new TraceSpool(path, deliverTrace, (error) => {
    logError('agent.trace.delivery_deferred', error)
  })

  return spool
}

export function writeTraceEvent(event: TraceEvent, payload: unknown): void {
  if (!config.agent.mongoTraceSpoolPath) return
  try {
    const ts = new Date()
    const retentionDays = config.agent.mongoTraceRetentionDays

    getSpool()?.enqueue({
      id: randomUUID(),
      sessionId: event.sessionId ?? null,
      header: JSON.stringify({
        ...event,
        ts,
        ...(retentionDays > 0
          ? {
              expiresAt: new Date(ts.getTime() + retentionDays * 86_400_000),
            }
          : {}),
      }),
      payload: serializeTracePayload(payload),
    })
  } catch (error) {
    failedWrites++
    logError('agent.trace.enqueue_failed', error, { span_id: event.spanId })
  }
}

async function deliverTrace(row: QueuedTrace): Promise<void> {
  const event = JSON.parse(row.header) as TraceEvent & { ts: string; expiresAt?: string }
  const { id, payload: json } = row
  const ts = new Date(event.ts)
  const expiry = event.expiresAt ? { expiresAt: new Date(event.expiresAt) } : {}
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
      if (attempt === 2) throw error // Keep the row on disk for later retry.
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt))
    }
  }
}

export async function flushTraceWrites(timeoutMs = 10_000): Promise<void> {
  await spool?.flush(timeoutMs)
  if (failedWrites) {
    const count = failedWrites

    failedWrites = 0
    throw new Error(`${String(count)} Mongo trace events could not be enqueued`)
  }
}

export async function closeTraceStore(timeoutMs = 10_000): Promise<void> {
  try {
    await flushTraceWrites(timeoutMs)
  } finally {
    spool?.close()
    spool = undefined
  }
}

export async function purgeConversationTraces(sessionId: string): Promise<void> {
  await spool?.purge(sessionId)
  await Promise.all([
    db().collection('agent_trace_payloads').deleteMany({ sessionId }),
    db().collection('agent_trace_events').deleteMany({ sessionId }),
  ])
}
