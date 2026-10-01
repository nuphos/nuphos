import { ExportResultCode } from '@opentelemetry/core'

import { errorMessage } from '@/lib/observability'
import { metricsRegistry } from '@/otel/metrics'

import type { ExportResult } from '@opentelemetry/core'
import type {
  Aggregation,
  AggregationTemporality,
  InstrumentType,
  PushMetricExporter,
  ResourceMetrics,
} from '@opentelemetry/sdk-metrics'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

const EXPORT_FAILURE_LOG_INTERVAL_MS = 60_000
// A collector that is simply absent (local dev pointed at the in-cluster
// endpoint, a misconfigured URL) fails on every single interval, forever. Once
// the failures are clearly not transient, widen the log interval so a dead
// endpoint costs one line every few minutes instead of one a minute for the
// life of the process.
const EXPORT_FAILURE_SUSTAINED_AFTER = 10
const EXPORT_FAILURE_SUSTAINED_LOG_INTERVAL_MS = 10 * 60_000

export function logJson(
  level: 'warn' | 'error',
  event: string,
  properties: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...properties,
  })

  if (level === 'error') {
    console.error(line)
  } else {
    console.warn(line)
  }
}

// Counts export failures and decides when one is worth a log line. Shared by
// the metric and span wrappers so both signals degrade the same way — before
// this, only metrics were wrapped and trace-export failures reached stderr as
// raw error objects (unstructured, unthrottled, and unparseable by the local
// dev dashboard).
class ExportFailureThrottle {
  private lastLogAt = 0
  private suppressed = 0
  private consecutive = 0
  private total = 0

  constructor(
    private readonly event: string,
    private readonly exporterLabel: string,
  ) {}

  succeeded(): void {
    this.suppressed = 0
    this.consecutive = 0
  }

  failed(error: unknown, failureType: string): void {
    this.consecutive += 1
    this.total += 1
    metricsRegistry().otelMetricExportFailures.add(1, {
      exporter: this.exporterLabel,
      failure_type: failureType,
    })
    this.suppressed += 1
    const interval =
      this.consecutive > EXPORT_FAILURE_SUSTAINED_AFTER
        ? EXPORT_FAILURE_SUSTAINED_LOG_INTERVAL_MS
        : EXPORT_FAILURE_LOG_INTERVAL_MS
    const now = Date.now()

    if (now - this.lastLogAt < interval) return
    logJson('warn', this.event, {
      exporter: this.exporterLabel,
      failure_type: failureType,
      consecutive_failures: this.consecutive,
      total_failures: this.total,
      suppressed_failures: this.suppressed - 1,
      message: errorMessage(error),
    })
    this.lastLogAt = now
    this.suppressed = 0
  }
}

export class TolerantMetricExporter implements PushMetricExporter {
  readonly selectAggregationTemporality?: (instrumentType: InstrumentType) => AggregationTemporality
  readonly selectAggregation?: (instrumentType: InstrumentType) => Aggregation

  private readonly failures = new ExportFailureThrottle('otel.metric_export_failed', 'otlp_http')

  constructor(private readonly delegate: PushMetricExporter) {
    if (delegate.selectAggregationTemporality) {
      this.selectAggregationTemporality = delegate.selectAggregationTemporality.bind(delegate)
    }
    if (delegate.selectAggregation) {
      this.selectAggregation = delegate.selectAggregation.bind(delegate)
    }
  }

  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    try {
      this.delegate.export(metrics, (result) => {
        if (result.code === ExportResultCode.SUCCESS) {
          this.failures.succeeded()
          resultCallback(result)

          return
        }

        this.failures.failed(result.error, 'export_result')
        // PeriodicExportingMetricReader throws on failed export results, which
        // routes transient collector timeouts through the global error handler
        // every interval. Report the loss once per throttle window and let the
        // reader keep collecting instead of flooding application logs.
        resultCallback({ code: ExportResultCode.SUCCESS })
      })
    } catch (err) {
      this.failures.failed(err, 'exception')
      resultCallback({ code: ExportResultCode.SUCCESS })
    }
  }

  async forceFlush(): Promise<void> {
    try {
      await this.delegate.forceFlush()
    } catch (err) {
      this.failures.failed(err, 'force_flush_exception')
    }
  }

  async shutdown(): Promise<void> {
    await this.delegate.shutdown()
  }
}

// Same treatment for traces. Without it, a failed span export surfaces as a raw
// error object on stderr via the global error handler — unstructured, on every
// batch, and (because it is not JSON) invisible to the local dev dashboard's
// log parser, which is how a dead collector produced hundreds of stack traces
// in a single local session. Spans are dropped either way; the only question is
// how loudly.
export class TolerantSpanExporter implements SpanExporter {
  private readonly failures = new ExportFailureThrottle('otel.trace_export_failed', 'otlp_http')

  constructor(private readonly delegate: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    try {
      this.delegate.export(spans, (result) => {
        if (result.code === ExportResultCode.SUCCESS) {
          this.failures.succeeded()
        } else {
          this.failures.failed(result.error, 'export_result')
        }
        // Always report success: BatchSpanProcessor routes a failure through
        // the global error handler, which is the noise this wrapper exists to
        // remove. The batch is already lost; re-reporting it changes nothing.
        resultCallback({ code: ExportResultCode.SUCCESS })
      })
    } catch (err) {
      this.failures.failed(err, 'exception')
      resultCallback({ code: ExportResultCode.SUCCESS })
    }
  }

  async forceFlush(): Promise<void> {
    try {
      await this.delegate.forceFlush?.()
    } catch (err) {
      this.failures.failed(err, 'force_flush_exception')
    }
  }

  async shutdown(): Promise<void> {
    await this.delegate.shutdown()
  }
}
