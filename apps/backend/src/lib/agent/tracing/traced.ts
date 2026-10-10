import { MongoTraceSpan, updateMongoParent } from '../trace-store/span'

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
