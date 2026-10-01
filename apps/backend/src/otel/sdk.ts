// sdk.ts — wires the three telemetry pipelines (traces / metrics / logs) into
// global providers and returns a single shutdown handle.
//
// We don't use `@opentelemetry/sdk-node` because:
//   1. Auto-instrumentations in that package hook Node's `require`, which Bun
//      does not implement the same way — they silently no-op or break.
//   2. Bun does ship a working AsyncLocalStorage, so manual instrumentation +
//      the AsyncHooksContextManager from OTel core is the reliable path.
//
// Public surface: `startTelemetry()` initialises providers and returns
// `{ shutdown }`; idempotent if already started.

import {
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  metrics,
  propagation,
  trace,
} from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import {
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base'

import { config } from '@/config'
import { errorMessage } from '@/lib/observability'
import { GenAIMetricsSpanProcessor } from '@/otel/instrumentation/genai'
import { buildResource } from '@/otel/resource'
import { logJson, TolerantMetricExporter, TolerantSpanExporter } from '@/otel/sdk-exporters'

import type { SpanProcessor } from '@opentelemetry/sdk-trace-base'

export type TelemetryShutdown = () => Promise<void>

let started = false
let shutdownFn: TelemetryShutdown = async () => {}

function diagLevel(name: string): DiagLogLevel {
  switch (name) {
    case 'none':
      return DiagLogLevel.NONE
    case 'error':
      return DiagLogLevel.ERROR
    case 'warn':
      return DiagLogLevel.WARN
    case 'info':
      return DiagLogLevel.INFO
    case 'debug':
      return DiagLogLevel.DEBUG
    case 'verbose':
      return DiagLogLevel.VERBOSE
    case 'all':
      return DiagLogLevel.ALL
    default:
      return DiagLogLevel.ERROR
  }
}

// Idempotent boot. Returns the shutdown handle from the original call on
// subsequent invocations so callers never need to coordinate ordering. If
// setup throws partway, we leave `started` false so the next call can retry
// instead of being permanently stuck with the no-op shutdownFn.
export function startTelemetry(): { shutdown: TelemetryShutdown } {
  if (started) return { shutdown: shutdownFn }

  const result = startTelemetryInner()

  started = true

  return result
}

function startTelemetryInner(): { shutdown: TelemetryShutdown } {
  const o = config.otel

  if (!o.enabled) {
    // Even when disabled we still register a context manager + W3C propagator
    // so that any code starting spans (e.g. AI SDK) gets a working no-op-y
    // tracer and trace-correlated logs continue to work as best-effort.
    const cm = new AsyncLocalStorageContextManager()

    cm.enable()
    context.setGlobalContextManager(cm)
    propagation.setGlobalPropagator(
      new CompositePropagator({
        propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
      }),
    )

    return { shutdown: shutdownFn }
  }

  diag.setLogger(new DiagConsoleLogger(), diagLevel(o.diagLogLevel))

  // ── Context + propagation ────────────────────────────────────────────────
  // AsyncHooksContextManager binds the active span to AsyncLocalStorage so a
  // request-scoped span flows across awaits, setTimeout, fetch handlers, etc.
  const contextManager = new AsyncLocalStorageContextManager()

  contextManager.enable()
  context.setGlobalContextManager(contextManager)

  // W3C tracecontext is the de-facto cross-service standard; baggage carries
  // request-scoped key/value pairs (e.g. tenant id) downstream.
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  )

  const resource = buildResource()

  // ── Traces ───────────────────────────────────────────────────────────────
  // We register a tracer provider whenever EITHER traces OR metrics are on:
  //   - Traces on → we need the BatchSpanProcessor + OTLP exporter.
  //   - Metrics on (traces off) → we still need the GenAIMetricsSpanProcessor
  //     attached to a real provider so AI SDK spans translate into the
  //     gen_ai.* metrics. Without a real provider the global tracer is a
  //     no-op and every AI SDK call produces an unrecorded span.
  let tracerProvider: BasicTracerProvider | undefined

  if (o.traces.enabled || o.metrics.enabled) {
    const sampler = new ParentBasedSampler({
      // Parent-based + ratio sampler: honor upstream's sampling decision when
      // a trace is already in-flight (so the trace is either fully sampled or
      // fully dropped across services), and fall back to ratio at the root.
      // In metrics-only mode the sampler value doesn't really matter — no
      // exporter is attached — but we keep it correct for completeness.
      root: new TraceIdRatioBasedSampler(o.traces.samplerRatio),
    })
    const spanProcessors: SpanProcessor[] = []

    // GenAI metrics MUST come before the batch exporter so it sees every
    // onEnd; the batch processor doesn't pass the span on.
    if (o.metrics.enabled) {
      spanProcessors.push(new GenAIMetricsSpanProcessor())
    }
    if (o.traces.enabled) {
      const exporter = new TolerantSpanExporter(
        new OTLPTraceExporter({
          url: o.exporter.tracesEndpoint,
          headers: o.exporter.tracesHeaders,
        }),
      )

      spanProcessors.push(
        new BatchSpanProcessor(exporter, {
          maxQueueSize: 4_096,
          maxExportBatchSize: 512,
          scheduledDelayMillis: 5_000,
          exportTimeoutMillis: 30_000,
        }),
      )
    }
    tracerProvider = new BasicTracerProvider({
      resource,
      sampler,
      spanProcessors,
    })
    trace.setGlobalTracerProvider(tracerProvider)
  }

  // ── Metrics ──────────────────────────────────────────────────────────────
  let meterProvider: MeterProvider | undefined

  if (o.metrics.enabled) {
    const exporter = new OTLPMetricExporter({
      url: o.exporter.metricsEndpoint,
      headers: o.exporter.metricsHeaders,
      // Delta temporality matches what Prometheus/Tempo/Grafana cloud expect
      // for OTLP push; backends that want cumulative will configure it on
      // their side (otelcol convert).
      temporalityPreference: AggregationTemporality.DELTA,
    })

    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new TolerantMetricExporter(exporter),
          exportIntervalMillis: o.metrics.exportIntervalMs,
          exportTimeoutMillis: o.metrics.exportTimeoutMs,
        }),
      ],
    })
    metrics.setGlobalMeterProvider(meterProvider)
  }

  // ── Logs ─────────────────────────────────────────────────────────────────
  let loggerProvider: LoggerProvider | undefined

  if (o.logs.enabled) {
    const exporter = new OTLPLogExporter({
      url: o.exporter.logsEndpoint,
      headers: o.exporter.logsHeaders,
    })

    loggerProvider = new LoggerProvider({ resource })
    loggerProvider.addLogRecordProcessor(
      new BatchLogRecordProcessor(exporter, {
        maxQueueSize: 4_096,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5_000,
        exportTimeoutMillis: 30_000,
      }),
    )
    logs.setGlobalLoggerProvider(loggerProvider)
  }

  // ── Shutdown ─────────────────────────────────────────────────────────────
  shutdownFn = async () => {
    // Order matters: drain logs and metrics LAST, after spans, so that any
    // trace_id we want to correlate has already been flushed.
    try {
      await tracerProvider?.shutdown()
    } catch (err) {
      logJson('warn', 'otel.tracer_shutdown_failed', { message: errorMessage(err) })
    }
    try {
      await meterProvider?.shutdown()
    } catch (err) {
      logJson('warn', 'otel.meter_shutdown_failed', { message: errorMessage(err) })
    }
    try {
      await loggerProvider?.shutdown()
    } catch (err) {
      logJson('warn', 'otel.logger_shutdown_failed', { message: errorMessage(err) })
    }
  }

  return { shutdown: shutdownFn }
}
