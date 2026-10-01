// hono.ts — middleware that opens a server span around every HTTP request and
// emits the RED histogram. It also extracts upstream W3C context so requests
// arriving with a `traceparent` header continue the existing trace.
//
// Why not a generic Node HTTP auto-instrumentation? Bun exposes requests via
// `Bun.serve`'s `fetch` handler, not via Node's `http` module — the standard
// auto-instrumentation would attach to an empty surface. Hono middleware is
// the right cut-point on this stack.

import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_NETWORK_PROTOCOL_VERSION,
  ATTR_URL_PATH,
  ATTR_URL_QUERY,
  ATTR_URL_SCHEME,
  ATTR_USER_AGENT_ORIGINAL,
} from '@opentelemetry/semantic-conventions'

import { getTracer, cleanAttrs } from '@/otel/api'
import { metricsRegistry } from '@/otel/metrics'

import type { MiddlewareHandler } from 'hono'

// Headers that frequently carry tokens / cookies — never put them on a span.
const REDACTED_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key'])

function extractIncomingContext(headers: Headers) {
  // Hono's Headers iterator yields lowercase keys, perfect for the
  // case-insensitive getter the W3C propagator expects.
  const carrier: Record<string, string> = {}

  for (const [k, v] of headers.entries()) carrier[k.toLowerCase()] = v

  return propagation.extract(context.active(), carrier, {
    get: (c, key) => c[key.toLowerCase()],
    keys: (c) => Object.keys(c),
  })
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

// Query params that carry credentials (e.g. the webhook receiver accepts
// ?secret= for senders that can't set custom headers, OAuth-style callers use
// access_token / client_secret, signed URLs carry signature). Redact their
// VALUES before the query string lands in a span attribute — traces are far
// more durable and widely readable than the request itself. Substring match on
// the param NAME, biased toward over-redaction: hiding a benign value from a
// trace costs nothing, leaking a credential is unrecoverable.
const SENSITIVE_QUERY_PARAM_PATTERN = /secret|token|key|passw|pwd|credential|signature|auth/i

function redactedQuery(url: URL | null): string | undefined {
  if (!url?.search) return undefined
  const params = new URLSearchParams(url.search)
  let redacted = false

  // Snapshot the key list before mutating: the loop writes back into the same
  // URLSearchParams, and a live iterator over a collection being edited is not
  // a contract worth leaning on in a leak-prevention path.
  // eslint-disable-next-line unicorn/no-useless-spread -- the spread is the snapshot, not decoration
  for (const name of [...params.keys()]) {
    if (SENSITIVE_QUERY_PARAM_PATTERN.test(name)) {
      params.set(name, '***')
      redacted = true
    }
  }

  return redacted ? params.toString() : url.search.slice(1)
}

// Tracing + metrics middleware. Mount it *after* trimTrailingSlash + requestId
// but *before* logger / cors so the span covers the whole request lifecycle.
export const otelHono = (): MiddlewareHandler => {
  const tracer = getTracer('hono')
  const m = metricsRegistry()

  return async (c, next) => {
    const start = performance.now()
    const url = safeUrl(c.req.url)
    const method = c.req.method
    const reqHeaders = c.req.raw.headers
    const userAgent = reqHeaders.get('user-agent') ?? undefined
    const requestLength = Number.parseInt(reqHeaders.get('content-length') ?? '', 10)

    const parentContext = extractIncomingContext(reqHeaders)

    // We don't know the route pattern until Hono has matched — start with the
    // raw path and rename later. This is the recommended pattern for low-
    // cardinality `http.route` attributes.
    const initialName = `${method} ${url?.pathname ?? c.req.path}`
    const span = tracer.startSpan(
      initialName,
      {
        kind: SpanKind.SERVER,
        attributes: cleanAttrs({
          [ATTR_HTTP_REQUEST_METHOD]: method,
          [ATTR_URL_PATH]: url?.pathname ?? c.req.path,
          [ATTR_URL_QUERY]: redactedQuery(url),
          [ATTR_URL_SCHEME]: url?.protocol?.replace(':', '') ?? undefined,
          [ATTR_USER_AGENT_ORIGINAL]: userAgent,
          [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
          'http.request.body.size': Number.isFinite(requestLength) ? requestLength : undefined,
          'atlas.request_id': (c as unknown as { get: (k: string) => unknown }).get('requestId') as
            string | undefined,
          // server.address / client.address are useful for partitioning by
          // upstream LB or pod-to-pod traffic.
          'server.address': url?.hostname,
          'server.port': url?.port ? Number(url.port) : undefined,
        }),
      },
      parentContext,
    )

    m.httpServerActive.add(1, { 'http.request.method': method })

    // Run downstream inside the active context so any spans/logs created in
    // route handlers attach to this server span.
    return context.with(trace.setSpan(parentContext, span), async () => {
      const safeMethod = method
      let status = 500
      let routeAttr: string | undefined
      let caughtError = false

      try {
        await next()
        status = c.res.status
        // Hono populates routePath once the route resolves.
        routeAttr = c.req.routePath ?? undefined
      } catch (err) {
        // Hono runs errorHandler after middlewares; the throw surfaces here
        // when an upstream middleware bubbles. We tag the span and rethrow so
        // errorHandler still serializes the response.
        caughtError = true
        span.recordException(err as Error)
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        })
        throw err
      } finally {
        const durationMs = performance.now() - start
        const respLengthHeader = c.res?.headers?.get('content-length')
        const respLength = respLengthHeader ? Number.parseInt(respLengthHeader, 10) : undefined

        if (routeAttr) {
          span.updateName(`${safeMethod} ${routeAttr}`)
          span.setAttribute(ATTR_HTTP_ROUTE, routeAttr)
        }
        span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, status)
        if (Number.isFinite(respLength) && respLength != null) {
          span.setAttribute('http.response.body.size', respLength)
        }

        // Attach late-bound user/team/tenant identifiers if the request set
        // them — they're high-value for trace filtering.
        const get = (c as unknown as { get: (k: string) => unknown }).get.bind(c)
        const userId = get('userId') as string | undefined
        const teamId = get('teamId') as string | undefined

        if (userId) span.setAttribute('atlas.user.id', userId)
        if (teamId) span.setAttribute('atlas.team.id', teamId)

        // 5xx is the standard "this trace is interesting" signal. 4xx is a
        // client error and shouldn't trip the alarm — leave the status unset.
        // Skip when the catch block already recorded a descriptive ERROR
        // status; OTel JS treats the last setStatus call as winning, so an
        // unconditional setStatus({ERROR}) here would clobber the message.
        if (status >= 500 && !caughtError) {
          span.setStatus({ code: SpanStatusCode.ERROR })
        }

        m.httpServerActive.add(-1, { 'http.request.method': method })
        // Semconv mandates seconds — convert from the performance.now() ms
        // delta we measured.
        m.httpServerRequestDuration.record(durationMs / 1_000, {
          [ATTR_HTTP_REQUEST_METHOD]: method,
          [ATTR_HTTP_RESPONSE_STATUS_CODE]: status,
          [ATTR_HTTP_ROUTE]: routeAttr ?? 'unmatched',
        })
        if (Number.isFinite(requestLength)) {
          m.httpServerRequestSize.record(requestLength, {
            [ATTR_HTTP_REQUEST_METHOD]: method,
          })
        }
        if (Number.isFinite(respLength) && respLength != null) {
          m.httpServerResponseSize.record(respLength, {
            [ATTR_HTTP_REQUEST_METHOD]: method,
            [ATTR_HTTP_RESPONSE_STATUS_CODE]: status,
          })
        }

        span.end()
      }
    })
  }
}

export { REDACTED_HEADERS }
