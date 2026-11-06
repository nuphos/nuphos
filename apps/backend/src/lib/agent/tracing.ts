// Agent tracing: full-content Mongo storage and OpenTelemetry instrumentation.

export { startTraceSpan } from './tracing/spans'
export { logSpanError, traced } from './tracing/traced'

export type { SpanLike } from './tracing/shared'
