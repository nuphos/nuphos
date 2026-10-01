import { logSpanError, startTraceSpan } from '@/lib/agent/braintrust'
import { errorTelemetryProperties, logError, logEvent } from '@/lib/observability'
import { capture } from '@/lib/posthog'

import type { AgentRunTrace } from './types'
import type { SpanLike } from '@/lib/agent/braintrust'

function traceSpans(trace: AgentRunTrace | undefined): SpanLike[] {
  const spans: SpanLike[] = []

  if (trace?.chatSpan) spans.push(trace.chatSpan)
  if (trace?.streamSpan && trace.streamSpan !== trace.chatSpan) spans.push(trace.streamSpan)

  return spans
}

function agentTraceLogProperties(
  trace: AgentRunTrace | undefined,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    request_id: trace?.requestId,
    user_id: trace?.userId,
    session_id: trace?.sessionId,
    team_id: trace?.teamId,
    stream_id: trace?.streamId,
    route: trace?.route,
    method: trace?.method,
    ...extras,
  }
}

function agentTraceSpanMetadata(
  trace: AgentRunTrace | undefined,
  event: string,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    requestId: trace?.requestId,
    userId: trace?.userId,
    sessionId: trace?.sessionId,
    teamId: trace?.teamId,
    streamId: trace?.streamId,
    route: trace?.route,
    method: trace?.method,
    phase: event,
    ...extras,
  }
}

/**
 * Every agent lifecycle event also becomes one PostHog `agent_lifecycle` row,
 * keyed by `phase` (the event name). One event name rather than a hundred: the
 * point is that a stuck turn can be reconstructed from PostHog alone by
 * filtering `stream_id` and reading `phase` in order, without knowing in
 * advance which of a hundred names to look for.
 *
 * Attributes are flattened to primitives — PostHog stores nested objects but
 * cannot filter on them, and a property you cannot filter on is a property you
 * will not find at 3am.
 */
function capturePhaseToPostHog(
  event: string,
  trace: AgentRunTrace | undefined,
  extras?: Record<string, unknown>,
  metrics?: Record<string, number>,
): void {
  const properties: Record<string, unknown> = {
    phase: event,
    request_id: trace?.requestId,
    session_id: trace?.sessionId,
    team_id: trace?.teamId,
    stream_id: trace?.streamId,
    route: trace?.route,
  }

  for (const [key, value] of Object.entries(extras ?? {})) {
    // Only real objects get flattened. `typeof null === 'object'`, so folding
    // null in here turned every deliberate `?? null` into the four-character
    // string "null" — which no `is null` filter matches, defeating the one
    // query this function exists to make possible.
    properties[key] = value !== null && typeof value === 'object' ? JSON.stringify(value) : value
  }
  for (const [key, value] of Object.entries(metrics ?? {})) properties[key] = value
  capture('agent_lifecycle', { distinctId: trace?.userId ?? 'unknown', properties })
}

export function traceAgentChatEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  trace: AgentRunTrace | undefined,
  extras?: Record<string, unknown>,
  metrics?: Record<string, number>,
): void {
  logEvent(level, event, agentTraceLogProperties(trace, extras))
  for (const span of traceSpans(trace)) {
    span.log({
      metadata: agentTraceSpanMetadata(trace, event, extras),
      metrics,
    })
    span.event(event, { ...extras, ...metrics, level })
  }
  capturePhaseToPostHog(event, trace, extras, metrics)
}

export function traceAgentChatError(
  event: string,
  error: unknown,
  trace: AgentRunTrace | undefined,
  extras?: Record<string, unknown>,
  metrics?: Record<string, number>,
): void {
  const errorProps = errorTelemetryProperties(error)

  logError(event, error, agentTraceLogProperties(trace, extras))
  for (const span of traceSpans(trace)) {
    logSpanError(span, error)
    span.log({
      metadata: agentTraceSpanMetadata(trace, event, {
        ...extras,
        ...errorProps,
      }),
      metrics,
    })
    span.event(event, { ...extras, ...errorProps, ...metrics, level: 'error' })
  }
  capturePhaseToPostHog(event, trace, { ...extras, ...errorProps }, metrics)
}

// Significant lifecycle events (turn pauses, the terminal client failure, pump
// read errors) deserve their OWN child span. Annotating the shared chat/stream
// span via `span.log({metadata})` overwrites `metadata.phase` — last write wins
// — so earlier events were invisible in Braintrust (e.g. a silence pause was
// always clobbered by the later sse-close event; `pump.started` never appeared
// at all). A dedicated child span keeps each event independently queryable by
// name, with its full detail and (for failures) the error attached. Fire-and-
// forget: telemetry must never delay or break the turn. Still emits the normal
// log line + parent annotation via traceAgentChatEvent/Error for stdout/OTel.
export function traceAgentChatSpanEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  trace: AgentRunTrace | undefined,
  extras?: Record<string, unknown>,
  error?: unknown,
): void {
  if (error !== undefined) traceAgentChatError(event, error, trace, extras)
  else traceAgentChatEvent(level, event, trace, extras)

  const parentSpan = trace?.streamSpan ?? trace?.chatSpan

  if (!parentSpan) return
  void (async () => {
    try {
      const parent = await parentSpan.export()

      if (!parent) return
      const span = startTraceSpan({
        name: event,
        type: 'task',
        parent,
        metadata: agentTraceSpanMetadata(trace, event, {
          ...extras,
          level,
          ...(error !== undefined ? errorTelemetryProperties(error) : {}),
        }),
      })

      if (error !== undefined) logSpanError(span, error)
      span.end()
    } catch {
      // A telemetry child span is best-effort; never surface its failure.
    }
  })()
}
