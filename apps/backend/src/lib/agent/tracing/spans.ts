import { context as otelContextApi, SpanStatusCode, trace } from '@opentelemetry/api'

import { MongoTraceSpan } from '../trace-store/span'

import {
  agentTracer,
  errorForOtel,
  lookupOtelParent,
  otelEnabled,
  payloadAttrs,
  prefixedAttrs,
  rememberOtelParent,
  safeError,
} from './shared'

import type { SpanLike, SpanType } from './shared'
import type { Attributes, Context as OtelContext, Span as OtelSpan } from '@opentelemetry/api'

export class AgentTraceSpan implements SpanLike {
  private localEnded = false

  constructor(
    private readonly mongoSpan: MongoTraceSpan,
    private readonly otelSpan: OtelSpan | undefined,
    private readonly otelSpanContext: OtelContext | undefined,
  ) {}

  async export(): Promise<string> {
    const exported = this.mongoSpan.export()

    rememberOtelParent(exported, this.otelSpanContext)

    return exported
  }

  log(event: {
    input?: unknown
    output?: unknown
    metadata?: Record<string, unknown>
    metrics?: Record<string, number>
    error?: unknown
  }): void {
    this.mongoSpan.record('log', event)
    if (!this.otelSpan) return
    if (event.error !== undefined) {
      const error = errorForOtel(event.error)

      this.otelSpan.recordException(error)
      this.otelSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
    }
    const attrs: Attributes = {
      ...prefixedAttrs('atlas.', event.metadata),
      ...prefixedAttrs('metric.', event.metrics),
      ...payloadAttrs('input', event.input),
      ...payloadAttrs('output', event.output),
      ...prefixedAttrs('error.', event.error ? safeError(event.error) : undefined),
    }

    this.otelSpan.addEvent('agent.span.log', attrs)
    if (event.metrics) this.otelSpan.setAttributes(prefixedAttrs('metric.', event.metrics))
  }

  event(name: string, attrs?: Record<string, unknown>): void {
    this.mongoSpan.record('event', { name, attributes: attrs })
    this.otelSpan?.addEvent(name, prefixedAttrs('atlas.', attrs))
  }

  end(): number {
    if (!this.localEnded) {
      this.localEnded = true
      this.mongoSpan.end()
      this.otelSpan?.end()
    }

    return Date.now() / 1000
  }

  withActive<R>(fn: () => R): R {
    return this.mongoSpan.withActive(() =>
      this.otelSpanContext ? otelContextApi.with(this.otelSpanContext, fn) : fn(),
    )
  }
}

function startOtelSpan(args: {
  name: string
  type?: SpanType
  parent?: string
  metadata?: Record<string, unknown>
  input?: unknown
}): { span?: OtelSpan; spanContext?: OtelContext } {
  if (!otelEnabled) return {}
  const parentContext = lookupOtelParent(args.parent) ?? otelContextApi.active()
  const span = agentTracer.startSpan(
    args.name,
    {
      attributes: {
        ...(args.type ? { 'atlas.span_type': args.type } : {}),
        ...prefixedAttrs('atlas.', args.metadata),
        ...payloadAttrs('input', args.input),
      },
    },
    parentContext,
  )

  return { span, spanContext: trace.setSpan(parentContext, span) }
}

export function startTraceSpan(args: {
  name: string
  type?: SpanType
  parent?: string
  metadata?: Record<string, unknown>
  input?: unknown
}): AgentTraceSpan {
  const { span, spanContext } = startOtelSpan(args)

  return new AgentTraceSpan(new MongoTraceSpan(args), span, spanContext)
}
