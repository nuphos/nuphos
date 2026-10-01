// metrics.ts — central registry of every metric this service emits. Keeping
// the names in one place prevents the typo-driven "we have two slightly
// different latency histograms" problem.
//
// Naming follows the OTel semantic-conventions style:
//   http.server.request.duration      (semconv stable)
//   db.client.operation.duration      (semconv stable)
//   {namespace}.{action}.{unit}       (custom)

import { getMeter } from '@/otel/api'

import type { Counter, Histogram, ObservableGauge, UpDownCounter } from '@opentelemetry/api'

// Lazy: instruments are created on first access so a `metrics.disabled=true`
// run still works (the global meter is a no-op).
type Registry = {
  // HTTP (RED — Rate / Errors / Duration)
  httpServerRequestDuration: Histogram
  httpServerRequestSize: Histogram
  httpServerResponseSize: Histogram
  httpServerActive: UpDownCounter

  // DB
  dbClientOperationDuration: Histogram
  dbClientErrors: Counter

  // Outbound HTTP
  httpClientRequestDuration: Histogram
  httpClientErrors: Counter

  // AI
  aiGenerationDuration: Histogram
  aiTokensInput: Counter
  aiTokensOutput: Counter
  aiTokensReasoning: Counter
  aiToolCalls: Counter

  // Runtime (filled by observable callbacks in runtime.ts)
  runtimeEventLoopLag: ObservableGauge
  runtimeMemoryRss: ObservableGauge
  runtimeMemoryHeapUsed: ObservableGauge
  runtimeMemoryHeapTotal: ObservableGauge
  runtimeMemoryExternal: ObservableGauge

  // Telemetry pipeline health
  otelMetricExportFailures: Counter
}

let cache: Registry | undefined

export function metricsRegistry(): Registry {
  if (cache) return cache
  const m = getMeter('metrics')

  cache = {
    httpServerRequestDuration: m.createHistogram('http.server.request.duration', {
      description: 'Duration of HTTP server requests',
      // Stable semconv name: spec mandates seconds. Recording in ms would make
      // every pre-built dashboard / SLO that targets this metric off by 1000×.
      unit: 's',
      // Histogram buckets tuned for an API workload: sub-ms internal
      // health checks up to long-running agent streams. Without explicit
      // buckets you get the default exponential histogram which is fine
      // for cheap backends but harder to graph in Grafana.
      advice: {
        explicitBucketBoundaries: [
          0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60,
        ],
      },
    }),
    httpServerRequestSize: m.createHistogram('http.server.request.body.size', {
      description: 'HTTP server request payload size',
      unit: 'By',
    }),
    httpServerResponseSize: m.createHistogram('http.server.response.body.size', {
      description: 'HTTP server response payload size',
      unit: 'By',
    }),
    httpServerActive: m.createUpDownCounter('http.server.active_requests', {
      description: 'In-flight HTTP server requests',
    }),

    dbClientOperationDuration: m.createHistogram('db.client.operation.duration', {
      description: 'Duration of DB client operations (mongo/redis)',
      unit: 's',
      advice: {
        explicitBucketBoundaries: [
          0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
        ],
      },
    }),
    dbClientErrors: m.createCounter('db.client.errors', {
      description: 'DB client errors by system + operation',
    }),

    httpClientRequestDuration: m.createHistogram('http.client.request.duration', {
      description: 'Duration of outbound HTTP requests',
      unit: 's',
      advice: {
        explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      },
    }),
    httpClientErrors: m.createCounter('http.client.errors', {
      description: 'Outbound HTTP errors (transport + 5xx)',
    }),

    aiGenerationDuration: m.createHistogram('gen_ai.client.operation.duration', {
      description: 'Duration of GenAI client operations',
      unit: 's',
    }),
    aiTokensInput: m.createCounter('gen_ai.client.token.usage.input', {
      description: 'Input tokens consumed',
      unit: '{token}',
    }),
    aiTokensOutput: m.createCounter('gen_ai.client.token.usage.output', {
      description: 'Output tokens emitted',
      unit: '{token}',
    }),
    aiTokensReasoning: m.createCounter('gen_ai.client.token.usage.reasoning', {
      description: 'Reasoning tokens consumed',
      unit: '{token}',
    }),
    aiToolCalls: m.createCounter('gen_ai.client.tool_calls', {
      description: 'Tool calls issued by the model',
    }),

    runtimeEventLoopLag: m.createObservableGauge('process.runtime.event_loop.lag', {
      description: 'Event loop delay (sampled)',
      unit: 'ms',
    }),
    runtimeMemoryRss: m.createObservableGauge('process.runtime.memory.rss', {
      description: 'Resident set size',
      unit: 'By',
    }),
    runtimeMemoryHeapUsed: m.createObservableGauge('process.runtime.memory.heap.used', {
      description: 'V8/JSC heap used',
      unit: 'By',
    }),
    runtimeMemoryHeapTotal: m.createObservableGauge('process.runtime.memory.heap.total', {
      description: 'V8/JSC heap total',
      unit: 'By',
    }),
    runtimeMemoryExternal: m.createObservableGauge('process.runtime.memory.external', {
      description: 'External (off-heap) memory',
      unit: 'By',
    }),

    otelMetricExportFailures: m.createCounter('otel.metric.export.failures', {
      description: 'Metric export failures observed by the OTLP metric exporter wrapper',
    }),
  }

  return cache
}
