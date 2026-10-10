import { context as otelContextApi } from '@opentelemetry/api'
import {
  startSpan as bStartSpan,
  traced as bTraced,
  updateSpan as bUpdateSpan,
  withParent as bWithParent,
} from 'braintrust'

import { logError } from '@/lib/observability'

import { MongoTraceSpan, updateMongoParent, withMongoParent } from '../trace-store/span'

import { braintrustParent, enabled, lookupOtelParent } from './shared'
import { DualTraceSpan, makeDualSpan, startTraceSpan } from './spans'

import type { SpanLike, SpanType } from './shared'
import type { Span as BraintrustSpan } from 'braintrust'

// Run `fn` inside an agent trace span. Braintrust receives the same span when
// enabled, while OTel is the primary backend trace path.
//
// `parent` is the exported handle of an enclosing span (from `span.export()`).
// Pass it when the enclosing span was created earlier and is no longer active
// in async-local context; without it the new span can land as an orphan root.
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
  if (!enabled) {
    const span = makeDualSpan(args)

    if (!(span instanceof DualTraceSpan)) return fn(span)

    return span.withActive(async () => {
      try {
        return await fn(span)
      } catch (err) {
        span.log({ error: err })
        throw err
      } finally {
        span.end()
      }
    })
  }

  return bTraced(
    async (span) => {
      const dualSpan = makeDualSpan(args, span)

      if (dualSpan instanceof DualTraceSpan) {
        return await dualSpan.withActive(async () => {
          try {
            return await fn(dualSpan)
          } catch (err) {
            dualSpan.log({ error: err })
            throw err
          } finally {
            dualSpan.endLocalSpans()
          }
        })
      }

      return await fn(dualSpan)
    },
    {
      name: args.name,
      type: args.type,
      event: { input: args.input, metadata: args.metadata },
      ...(braintrustParent(args.parent) ? { parent: braintrustParent(args.parent) } : {}),
    },
  )
}

// Creates the "conversation" root span and returns its exported parent
// reference, following Braintrust's session-root pattern for multi-turn chat:
// https://www.braintrust.dev/docs/kb/stitch-multi-turn-chat-into-one-trace-with-wrapaisdk
// https://www.braintrust.dev/docs/kb/create-a-root-span-with-client-generated-conversation-ids
//
// `spanId` is passed straight through to Braintrust so the conversation row
// has a stable, client-generated ID matching our `sessionId`. Per the KB
// article, this unlocks root-only UI features — the **+ Playground** button,
// root-span scoring, and trace-level input/output/metadata/tags display.
//
// The span is ended immediately. Per the docs ("The SDK resolves parent
// relationships from the IDs encoded in the export() string, not from a live
// span reference"), later turns can still attach as children via the exported
// parent string even after the root has been ended.
export async function createConversationParent(args: {
  name?: string
  spanId?: string
  metadata?: Record<string, unknown>
  metrics?: Record<string, number>
  input?: unknown
  output?: unknown
}): Promise<string | undefined> {
  if (!enabled) {
    const mongoSpan = new MongoTraceSpan({
      ...args,
      name: args.name ?? 'conversation',
      type: 'task',
    })

    mongoSpan.end()

    return mongoSpan.export()
  }
  const span = bStartSpan({
    name: args.name ?? 'conversation',
    type: 'task',
    ...(args.spanId ? { spanId: args.spanId } : {}),
    event: {
      ...(args.input !== undefined ? { input: args.input } : {}),
      ...(args.output !== undefined ? { output: args.output } : {}),
      ...(args.metadata ? { metadata: args.metadata } : {}),
      ...(args.metrics ? { metrics: args.metrics } : {}),
    },
  })

  const mongoSpan = new MongoTraceSpan(
    { ...args, name: args.name ?? 'conversation', type: 'task' },
    span,
  )

  try {
    return mongoSpan.export(await span.export())
  } finally {
    mongoSpan.end()
    span.end()
  }
}

// Updates the conversation root span (referenced by its exported handle) with
// fresh metrics or metadata. Used at each turn's `onFinish` so the
// conversation row in Braintrust shows live duration + cumulative token totals
// across the whole multi-turn chat instead of the near-zero duration that
// would otherwise result from ending the root span on its first millisecond.
// No-op when Braintrust is disabled or `exported` is missing.
export function updateConversationParent(
  exported: string | undefined,
  event: { metadata?: Record<string, unknown>; metrics?: Record<string, number> },
): void {
  if (!exported) return
  updateMongoParent(exported, event)
  const btParent = braintrustParent(exported)

  if (!enabled || !btParent) return
  try {
    bUpdateSpan({
      exported: btParent,
      ...(event.metadata ? { metadata: event.metadata } : {}),
      ...(event.metrics ? { metrics: event.metrics } : {}),
    })
  } catch (err) {
    logError('braintrust.conversation_parent_update_failed', err)
  }
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

// Restores the exported parent for integrations that resolve parentage from
// async-local context. Braintrust uses its own currentParent store; OTel uses
// the Context API. This is what keeps AI SDK spans under agent.chat.stream.
export function withTraceParent<R>(parent: string | undefined, fn: () => R): R {
  const otelParent = lookupOtelParent(parent)
  const run = () => {
    const btParent = braintrustParent(parent)

    if (!enabled || !btParent) return fn()

    return bWithParent(btParent, fn)
  }

  return withMongoParent(parent, () => (otelParent ? otelContextApi.with(otelParent, run) : run()))
}
