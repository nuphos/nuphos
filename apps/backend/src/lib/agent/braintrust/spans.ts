import { randomUUID } from 'node:crypto'

import { context as otelContextApi, SpanStatusCode, trace } from '@opentelemetry/api'
import { logError as bLogError, startSpan as bStartSpan } from 'braintrust'

import { logError } from '@/lib/observability'

import {
  agentTracer,
  braintrustParent,
  enabled,
  errorForOtel,
  lookupOtelParent,
  noopSpan,
  OTEL_PARENT_PREFIX,
  otelEnabled,
  payloadAttrs,
  prefixedAttrs,
  rememberOtelParent,
  safeError,
} from './shared'

import type { SpanLike, SpanType } from './shared'
import type { Attributes, Context as OtelContext, Span as OtelSpan } from '@opentelemetry/api'
import type { Span as BraintrustSpan } from 'braintrust'

export class DualTraceSpan implements SpanLike {
  private braintrustEnded = false
  private otelEnded = false
  private syntheticExport?: string

  constructor(
    private readonly braintrustSpan: BraintrustSpan | undefined,
    private readonly otelSpan: OtelSpan | undefined,
    private readonly otelSpanContext: OtelContext | undefined,
  ) {}

  async export(): Promise<string> {
    let exported = ''

    if (this.braintrustSpan) {
      try {
        exported = await this.braintrustSpan.export()
      } catch (err) {
        logError('braintrust.span_export_failed', err)
      }
    }
    if (!exported && this.otelSpanContext) {
      this.syntheticExport ??= `${OTEL_PARENT_PREFIX}${randomUUID()}`
      exported = this.syntheticExport
    }
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
    if (event.error !== undefined && this.braintrustSpan) {
      bLogError(this.braintrustSpan, event.error)
    }
    this.braintrustSpan?.log({
      ...event,
      ...(event.error !== undefined ? { error: safeError(event.error) } : {}),
    })
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
    this.otelSpan?.addEvent(name, prefixedAttrs('atlas.', attrs))
  }

  end(): number {
    this.endBraintrust()
    this.endOtel()

    return Date.now() / 1000
  }

  endBraintrust(): void {
    if (this.braintrustEnded) return
    this.braintrustEnded = true
    this.braintrustSpan?.end()
  }

  endOtel(): void {
    if (this.otelEnded) return
    this.otelEnded = true
    this.otelSpan?.end()
  }

  withActive<R>(fn: () => R): R {
    return this.otelSpanContext ? otelContextApi.with(this.otelSpanContext, fn) : fn()
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

export function makeDualSpan(
  args: {
    name: string
    type?: SpanType
    parent?: string
    metadata?: Record<string, unknown>
    input?: unknown
  },
  braintrustSpan?: BraintrustSpan,
): DualTraceSpan | SpanLike {
  const { span, spanContext } = startOtelSpan(args)

  if (!braintrustSpan && !span) return noopSpan

  return new DualTraceSpan(braintrustSpan, span, spanContext)
}

export function startTraceSpan(args: {
  name: string
  type?: SpanType
  parent?: string
  metadata?: Record<string, unknown>
  input?: unknown
}): SpanLike {
  const braintrustSpan = enabled
    ? bStartSpan({
        name: args.name,
        type: args.type,
        ...(braintrustParent(args.parent) ? { parent: braintrustParent(args.parent) } : {}),
        event: {
          ...(args.input !== undefined ? { input: args.input } : {}),
          ...(args.metadata ? { metadata: args.metadata } : {}),
        },
      })
    : undefined

  return makeDualSpan(args, braintrustSpan)
}
