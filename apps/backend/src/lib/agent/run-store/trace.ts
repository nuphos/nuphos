import { logSpanError } from '@/lib/agent/braintrust'
import { errorTelemetryProperties, logError, logEvent } from '@/lib/observability'
import { replicaId } from '@/lib/redis'

import type { SpanLike } from '@/lib/agent/braintrust'

export type AgentRunStoreTrace = {
  requestId?: string
  userId: string
  sessionId?: string
  teamId?: string
  streamId: string
  span?: SpanLike
  endSpanOnClose?: boolean
}

function runStoreTraceProperties(
  trace: AgentRunStoreTrace | undefined,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    request_id: trace?.requestId,
    user_id: trace?.userId,
    session_id: trace?.sessionId,
    team_id: trace?.teamId,
    stream_id: trace?.streamId,
    redis_replica_id: replicaId,
    ...extras,
  }
}

function runStoreSpanMetadata(
  trace: AgentRunStoreTrace | undefined,
  phase: string,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    requestId: trace?.requestId,
    userId: trace?.userId,
    sessionId: trace?.sessionId,
    teamId: trace?.teamId,
    streamId: trace?.streamId,
    redisReplicaId: replicaId,
    phase,
    ...extras,
  }
}

export function traceRunStoreEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  trace: AgentRunStoreTrace | undefined,
  extras?: Record<string, unknown>,
): void {
  logEvent(level, event, runStoreTraceProperties(trace, extras))
  trace?.span?.log({
    metadata: runStoreSpanMetadata(trace, event, extras),
  })
}

export function traceRunStoreError(
  event: string,
  error: unknown,
  trace: AgentRunStoreTrace | undefined,
  extras?: Record<string, unknown>,
): void {
  logError(event, error, runStoreTraceProperties(trace, extras))
  if (trace?.span) {
    logSpanError(trace.span, error)
    trace.span.log({
      metadata: {
        ...runStoreSpanMetadata(trace, event, extras),
        ...errorTelemetryProperties(error),
      },
    })
  }
}

export function runStoreErrorFrame(
  errorCode: string,
  errorText: string,
  trace: AgentRunStoreTrace | undefined,
  details?: Record<string, unknown>,
): string {
  return `data: ${JSON.stringify({
    type: 'error',
    errorCode,
    errorText,
    requestId: trace?.requestId,
    userId: trace?.userId,
    sessionId: trace?.sessionId,
    teamId: trace?.teamId,
    streamId: trace?.streamId,
    details: {
      redisReplicaId: replicaId,
      ...details,
    },
  })}\n\n`
}
