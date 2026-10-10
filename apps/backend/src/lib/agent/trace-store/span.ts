import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'

import { SpanComponentsV4 } from 'braintrust/util'

import { writeTraceEvent } from './store'

import type { TraceEvent } from './store'

const PREFIX = 'mongo:'

type Parent = {
  spanId: string
  rootSpanId: string
  braintrust?: string
  metadata?: Record<string, unknown>
}
const active = new AsyncLocalStorage<Parent>()

export function traceParent(parent?: string): Parent | undefined {
  if (!parent) return active.getStore()
  if (parent.startsWith(PREFIX)) {
    try {
      return JSON.parse(Buffer.from(parent.slice(PREFIX.length), 'base64url').toString()) as Parent
    } catch {
      return undefined
    }
  }
  try {
    const data = SpanComponentsV4.fromStr(parent).data

    if (data.span_id && data.root_span_id)
      return { spanId: data.span_id, rootSpanId: data.root_span_id, braintrust: parent }
  } catch {
    // Legacy OTel handles have no vendor span ids.
  }
  // Stable across replicas/restarts for conversation handles saved before
  // Mongo tracing existed. Never retain a process-local alias map.
  const spanId = createHash('sha256').update(parent).digest('hex')

  return { spanId, rootSpanId: spanId, braintrust: parent }
}

export function vendorParent(parent?: string): string | undefined {
  return parent?.startsWith(PREFIX) ? traceParent(parent)?.braintrust : parent
}

export function withMongoParent<T>(parent: string | undefined, fn: () => T): T {
  const context = traceParent(parent)

  return context ? active.run(context, fn) : fn()
}

export class MongoTraceSpan {
  readonly context: Parent
  private sequence = 0
  private ended = false
  private readonly fields: Omit<TraceEvent, 'sequence' | 'kind'>

  constructor(
    args: {
      name: string
      type?: string
      parent?: string
      metadata?: Record<string, unknown>
      input?: unknown
      spanId?: string
    },
    identity?: { spanId: string; rootSpanId: string; spanParents: string[] },
  ) {
    const parent = args.spanId ? undefined : traceParent(args.parent)
    const spanId = identity?.spanId ?? args.spanId ?? randomUUID()
    const metadata = { ...parent?.metadata, ...args.metadata }

    this.context = {
      spanId,
      rootSpanId: identity?.rootSpanId ?? parent?.rootSpanId ?? spanId,
      metadata,
    }
    this.fields = {
      spanId,
      rootSpanId: this.context.rootSpanId,
      ...(identity?.spanParents[0] || parent
        ? { parentSpanId: identity?.spanParents[0] ?? parent?.spanId }
        : {}),
      name: args.name,
      type: args.type,
      ...Object.fromEntries(
        ['sessionId', 'teamId', 'userId'].flatMap((key) =>
          typeof metadata[key] === 'string' ? [[key, metadata[key]]] : [],
        ),
      ),
    }
    this.record('start', { ...args, metadata, start: Date.now() / 1000 })
  }

  export(braintrust?: string): string {
    if (braintrust) return braintrust
    const metadata = Object.fromEntries(
      ['sessionId', 'teamId', 'userId'].flatMap((key) =>
        this.context.metadata?.[key] ? [[key, this.context.metadata[key]]] : [],
      ),
    )

    return PREFIX + Buffer.from(JSON.stringify({ ...this.context, metadata })).toString('base64url')
  }

  record(kind: TraceEvent['kind'], payload: unknown): void {
    writeTraceEvent({ ...this.fields, sequence: this.sequence++, kind }, payload)
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    this.record('end', { end: Date.now() / 1000 })
  }

  withActive<T>(fn: () => T): T {
    return active.run(this.context, fn)
  }
}

export function updateMongoParent(
  exported: string,
  event: { metadata?: Record<string, unknown>; metrics?: Record<string, number> },
): void {
  const parent = traceParent(exported)

  if (!parent) return
  writeTraceEvent(
    {
      spanId: parent.spanId,
      rootSpanId: parent.rootSpanId,
      sequence: 0,
      kind: 'update',
      ...Object.fromEntries(
        ['sessionId', 'teamId', 'userId'].flatMap((key) => {
          const value = event.metadata?.[key] ?? parent.metadata?.[key]

          return typeof value === 'string' ? [[key, value]] : []
        }),
      ),
    },
    event,
  )
}
