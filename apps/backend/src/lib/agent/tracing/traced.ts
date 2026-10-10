import { context as otelContextApi } from '@opentelemetry/api'

import { MongoTraceSpan, updateMongoParent, withMongoParent } from '../trace-store/span'

import { lookupOtelParent } from './shared'
import { startTraceSpan } from './spans'

import type { SpanLike, SpanType } from './shared'

export async function traced<T>(
  args: {
    name: string
    type?: SpanType
    parent?: string
    metadata?: Record<string, unknown>
    input?: unknown
  },
  fn: (span: SpanLike) => Promise<T>,
): Promise<T> {
  const span = startTraceSpan(args)

  return span.withActive(async () => {
    try {
      return await fn(span)
    } catch (error) {
      span.log({ error })
      throw error
    } finally {
      span.end()
    }
  })
}

// Stable conversation identity is independent of any external tracing service.
export async function createConversationParent(args: {
  name?: string
  spanId?: string
  metadata?: Record<string, unknown>
  metrics?: Record<string, number>
  input?: unknown
  output?: unknown
}): Promise<string | undefined> {
  const span = new MongoTraceSpan({ ...args, name: args.name ?? 'conversation', type: 'task' })

  span.end()

  return span.export()
}

export function updateConversationParent(
  exported: string | undefined,
  event: { metadata?: Record<string, unknown>; metrics?: Record<string, number> },
): void {
  if (exported) updateMongoParent(exported, event)
}

export function logSpanError(span: SpanLike, error: unknown) {
  span.log({ error })
}

// Log a single self-contained event span nested under an existing conversation
// root (referenced by its exported `parent` handle). Unlike `traced()`, there
// is no wrapped work — the span is started, logged, and ended immediately. Used
// for out-of-band signals that arrive after a turn has finished, e.g. an xtrace
// memory-learning webhook, so the extracted-memory outcome lands on the same
// conversation trace as the chat that triggered it. No-op when neither tracing
// sink is enabled.
export function logConversationEvent(args: {
  parent: string
  name: string
  type?: SpanType
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
  metrics?: Record<string, number>
  error?: unknown
}): void {
  const span = startTraceSpan({
    name: args.name,
    type: args.type ?? 'function',
    parent: args.parent,
    ...(args.input !== undefined ? { input: args.input } : {}),
    ...(args.metadata ? { metadata: args.metadata } : {}),
  })

  span.log({
    ...(args.output !== undefined ? { output: args.output } : {}),
    ...(args.metrics ? { metrics: args.metrics } : {}),
    ...(args.error !== undefined ? { error: args.error } : {}),
  })
  span.end()
}

export function withTraceParent<R>(parent: string | undefined, fn: () => R): R {
  const otelParent = lookupOtelParent(parent)

  return withMongoParent(parent, () => (otelParent ? otelContextApi.with(otelParent, fn) : fn()))
}
