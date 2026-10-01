// fetch.ts — patches the global fetch with an OTel CLIENT span around every
// outbound HTTP call AND injects W3C tracecontext headers so downstream
// services join the same trace.
//
// Bun's fetch is the only HTTP client primitive in this codebase (AWS SDK,
// google-cloud-*, AI SDK all use fetch underneath via their respective HTTP
// drivers); patching it once covers everything.

import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_FULL,
} from '@opentelemetry/semantic-conventions'

import { config } from '@/config'
import { getTracer } from '@/otel/api'
import { metricsRegistry } from '@/otel/metrics'

let installed = false

export function instrumentGlobalFetch(): void {
  if (installed) return
  // Gate on master enabled flag only: if metrics-only mode is selected we
  // still want this patch active so http.client.request.duration gets recorded.
  // Span creation against a disabled tracer provider becomes a no-op anyway.
  if (!config.otel.enabled) return
  if (!config.otel.traces.enabled && !config.otel.metrics.enabled) return
  installed = true

  const tracer = getTracer('fetch')
  const m = metricsRegistry()
  const original = globalThis.fetch.bind(globalThis)

  // Pre-compute OTLP endpoint origins so the exporter's own HTTP calls are
  // NOT traced. Without this, every flush spawns a CLIENT span that lands in
  // the BatchSpanProcessor queue, which gets exported, which spawns another
  // span — a perpetual loop that also distorts http.client.* metrics under
  // the collector's hostname.
  const otlpOrigins = new Set<string>(
    [
      config.otel.exporter.tracesEndpoint,
      config.otel.exporter.metricsEndpoint,
      config.otel.exporter.logsEndpoint,
    ].flatMap((ep) => {
      try {
        return [new URL(ep).origin]
      } catch {
        return []
      }
    }),
  )

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    let urlString: string
    let method: string

    if (typeof input === 'string') {
      urlString = input
      method = (init?.method ?? 'GET').toUpperCase()
    } else if (input instanceof URL) {
      urlString = input.toString()
      method = (init?.method ?? 'GET').toUpperCase()
    } else {
      // Request object
      urlString = input.url
      method = (init?.method ?? input.method ?? 'GET').toUpperCase()
    }

    let parsed: URL | undefined

    try {
      parsed = new URL(urlString)
    } catch {
      // Non-URL fetch — should not happen in practice, fall through to the
      // original implementation without a span.
      return original(input as Parameters<typeof fetch>[0], init)
    }

    // Bypass the OTLP exporter's own calls — see otlpOrigins comment above.
    if (otlpOrigins.has(parsed.origin)) {
      return original(input as Parameters<typeof fetch>[0], init)
    }

    const span = tracer.startSpan(`HTTP ${method}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        [ATTR_HTTP_REQUEST_METHOD]: method,
        [ATTR_URL_FULL]: redactUrl(parsed),
        [ATTR_SERVER_ADDRESS]: parsed.hostname,
        [ATTR_SERVER_PORT]: parsed.port
          ? Number(parsed.port)
          : parsed.protocol === 'https:'
            ? 443
            : 80,
      },
    })
    // Activate the span as the current context so any child spans / logs
    // emitted inside the fetch (e.g. by middleware running on a fetch-based
    // proxy) parent off this span, not the request span above us.
    const spanCtx = trace.setSpan(context.active(), span)

    // Inject W3C tracecontext + baggage headers so the downstream service
    // joins this trace.
    const headers = new Headers(
      init?.headers ??
        (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined),
    )

    propagation.inject(spanCtx, headers, {
      set: (carrier, key, value) => {
        carrier.set(key, value)
      },
    })
    const patchedInit: RequestInit = { ...(init ?? {}), headers }

    const start = performance.now()

    try {
      const res = await context.with(spanCtx, () =>
        original(input as Parameters<typeof fetch>[0], patchedInit),
      )
      const durationMs = performance.now() - start

      span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, res.status)
      if (res.status >= 400) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${String(res.status)}`,
        })
        if (res.status >= 500) {
          m.httpClientErrors.add(1, {
            [ATTR_SERVER_ADDRESS]: parsed.hostname,
            [ATTR_HTTP_RESPONSE_STATUS_CODE]: res.status,
          })
        }
      }
      // Semconv: http.client.request.duration is in seconds.
      m.httpClientRequestDuration.record(durationMs / 1_000, {
        [ATTR_HTTP_REQUEST_METHOD]: method,
        [ATTR_SERVER_ADDRESS]: parsed.hostname,
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: res.status,
      })

      return res
    } catch (err) {
      const durationMs = performance.now() - start

      if (err instanceof Error) span.recordException(err)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
      m.httpClientRequestDuration.record(durationMs / 1_000, {
        [ATTR_HTTP_REQUEST_METHOD]: method,
        [ATTR_SERVER_ADDRESS]: parsed.hostname,
        'error.type': err instanceof Error ? err.name : 'fetch_error',
      })
      m.httpClientErrors.add(1, {
        [ATTR_SERVER_ADDRESS]: parsed.hostname,
        'error.type': err instanceof Error ? err.name : 'fetch_error',
      })
      throw err
    } finally {
      span.end()
    }
  }) as typeof fetch
}

// Strip userinfo and obvious query secret keys before recording url.full.
const SECRET_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'api_key',
  'apikey',
  'key',
  'secret',
  'password',
])

function redactUrl(url: URL): string {
  const clone = new URL(url.toString())

  clone.username = ''
  clone.password = ''
  // URLSearchParams keys are case-sensitive per the WHATWG URL spec, so
  // `apiKey` / `TOKEN` / `Access_Token` would slip past a static list. Iterate
  // actual keys and match case-insensitively. We replace via .set(originalKey)
  // so the URL preserves its original casing (only the value is masked).
  // Snapshot the key list before mutating: the loop writes back into the same
  // URLSearchParams, and a live iterator over a collection being edited is not
  // a contract worth leaning on in a leak-prevention path.
  // eslint-disable-next-line unicorn/no-useless-spread -- the spread is the snapshot, not decoration
  for (const k of [...clone.searchParams.keys()]) {
    if (SECRET_QUERY_KEYS.has(k.toLowerCase())) {
      clone.searchParams.set(k, '[redacted]')
    }
  }

  return clone.toString()
}
