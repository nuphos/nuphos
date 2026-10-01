import { bool, boundedFloat, boundedInt, optional } from './env'

// Parses an OTLP `headers` string in the format `k1=v1,k2=v2`. URL-encoded
// values are decoded so users can pass tokens that contain `=` or `,`
// (matches the OTEL_EXPORTER_OTLP_HEADERS spec).
function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  const out: Record<string, string> = {}

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()

    if (!trimmed) continue
    const eq = trimmed.indexOf('=')

    if (eq <= 0) continue
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim()

    if (!k) continue
    try {
      out[k] = decodeURIComponent(v)
    } catch {
      out[k] = v
    }
  }

  return out
}

export function otelConfig() {
  const enabled = bool('OTEL_ENABLED', false)
  const baseEndpoint =
    optional('OTEL_EXPORTER_OTLP_ENDPOINT')?.replace(/\/$/, '') ?? 'http://localhost:4318'
  const baseHeaders = parseHeaders(optional('OTEL_EXPORTER_OTLP_HEADERS'))

  // Per-signal endpoint/header overrides: spec allows callers to override the
  // shared OTLP endpoint for a specific signal (e.g. send traces to Tempo but
  // logs to Loki). When unset we append the per-signal path to the base.
  const tracesEndpoint =
    optional('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT') ?? `${baseEndpoint}/v1/traces`
  const metricsEndpoint =
    optional('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT') ?? `${baseEndpoint}/v1/metrics`
  const logsEndpoint = optional('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT') ?? `${baseEndpoint}/v1/logs`

  return {
    enabled,
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'atlas-backend',
    serviceVersion:
      optional('OTEL_SERVICE_VERSION') ??
      optional('ATLAS_BACKEND_VERSION') ??
      optional('GIT_SHA') ??
      '0.1.0',
    deploymentEnvironment:
      optional('OTEL_DEPLOYMENT_ENVIRONMENT') ?? optional('NODE_ENV') ?? 'development',
    // Hostname identifies the replica in k8s; matches the redis.ts replicaId
    // so logs/traces/metrics correlate with the pub/sub channel name.
    podName: optional('HOSTNAME'),
    podNamespace: optional('POD_NAMESPACE'),
    nodeName: optional('NODE_NAME'),
    // Free-form additional resource attributes: "k1=v1,k2=v2" — spec env var.
    resourceAttributes: parseHeaders(optional('OTEL_RESOURCE_ATTRIBUTES')),

    exporter: {
      tracesEndpoint,
      metricsEndpoint,
      logsEndpoint,
      headers: baseHeaders,
      tracesHeaders: {
        ...baseHeaders,
        ...parseHeaders(optional('OTEL_EXPORTER_OTLP_TRACES_HEADERS')),
      },
      metricsHeaders: {
        ...baseHeaders,
        ...parseHeaders(optional('OTEL_EXPORTER_OTLP_METRICS_HEADERS')),
      },
      logsHeaders: {
        ...baseHeaders,
        ...parseHeaders(optional('OTEL_EXPORTER_OTLP_LOGS_HEADERS')),
      },
    },

    traces: {
      enabled: enabled && bool('OTEL_TRACES_ENABLED', true),
      // Parent-based ratio sampler. 1.0 = always-on; in production aim for
      // 0.05–0.20 to keep cost down while preserving statistical coverage.
      samplerRatio: boundedFloat('OTEL_TRACES_SAMPLER_ARG', 1, {
        min: 0,
        max: 1,
      }),
      maxAttributeValueLength: boundedInt('OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT', 4096, {
        min: 64,
        max: 65_536,
      }),
      // Bodies/queries get truncated to keep payloads bounded. Captured query
      // text is also redacted for keys that look secret.
      maxDbStatementLength: boundedInt('OTEL_DB_STATEMENT_LENGTH_LIMIT', 2048, {
        min: 64,
        max: 65_536,
      }),
      // Privacy-first default: we DO NOT include argument values on mongo /
      // redis spans because they routinely contain PII, tokens, encrypted
      // blobs, etc. Operators with a sanitised collector or a test environment
      // can opt in with OTEL_DB_CAPTURE_STATEMENT=true.
      captureDbStatement: bool('OTEL_DB_CAPTURE_STATEMENT', false),
    },

    metrics: {
      enabled: enabled && bool('OTEL_METRICS_ENABLED', true),
      exportIntervalMs: boundedInt('OTEL_METRIC_EXPORT_INTERVAL', 15_000, {
        min: 1_000,
        max: 300_000,
      }),
      exportTimeoutMs: boundedInt('OTEL_METRIC_EXPORT_TIMEOUT', 10_000, {
        min: 500,
        max: 60_000,
      }),
      runtimeIntervalMs: boundedInt('OTEL_RUNTIME_METRIC_INTERVAL_MS', 10_000, {
        min: 1_000,
        max: 60_000,
      }),
    },

    logs: {
      enabled: enabled && bool('OTEL_LOGS_ENABLED', true),
      // Minimum level shipped to OTLP. Console mirroring is unconditional so
      // operators don't lose visibility when the exporter is misconfigured.
      level: (optional('OTEL_LOG_LEVEL') ?? 'info').toLowerCase(),
      // Mirror every log record to stdout in JSON form. Defaults on so that
      // kubectl logs / docker logs still work as a fallback.
      console: bool('OTEL_LOG_CONSOLE', true),
    },

    // Print SDK diagnostics to stdout. Only enable while debugging the OTel
    // pipeline itself — the SDK is verbose at DEBUG.
    diagLogLevel: (optional('OTEL_LOG_LEVEL_DIAG') ?? 'error').toLowerCase(),
  } as const
}
