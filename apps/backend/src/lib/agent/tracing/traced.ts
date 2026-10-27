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

export function logSpanError(span: SpanLike, error: unknown) {
  span.log({ error })
}
