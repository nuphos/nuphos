// mongo.ts — instruments the MongoClient by subscribing to driver-emitted
// command monitoring events. This is the cleanest hook the driver offers; we
// avoid prototype-patching every Collection method.
//
// We:
//   - Open a span on `commandStarted` and key it by requestId so we can pair
//     it with the matching succeeded/failed event.
//   - Capture db.system, db.namespace, db.operation, db.statement (truncated,
//     never including the bind variables that the driver puts in the same
//     field for some commands).
//   - Record a duration histogram on every operation, success or fail.

import { SpanKind, SpanStatusCode } from '@opentelemetry/api'

import { config } from '@/config'
import { getTracer } from '@/otel/api'
import { metricsRegistry } from '@/otel/metrics'

import type { Span, Tracer } from '@opentelemetry/api'
import type {
  CommandFailedEvent,
  CommandStartedEvent,
  CommandSucceededEvent,
  MongoClient,
} from 'mongodb'

const DB_SYSTEM = 'mongodb'

// Privacy-first: by default `db.query.text` is just the command name. Filters,
// pipeline literals, and document values from a `find` or `aggregate` would
// otherwise leak into telemetry. Operators that want richer statements can opt
// in via OTEL_DB_CAPTURE_STATEMENT=true — when on, we still strip server-
// session fields and redact non-primitive argument values down to their shape.

function statementFor(cmdName: string, command: Record<string, unknown>): string {
  if (!config.otel.traces.captureDbStatement) return cmdName
  try {
    const safe: Record<string, unknown> = {}

    for (const [k, v] of Object.entries(command)) {
      // Always strip these — never useful for the statement field and routinely
      // contain credentials/PII when present.
      if (k === 'lsid' || k === '$clusterTime' || k === 'txnNumber' || k === '$db') continue
      // String collection name on `find: "users"` / `aggregate: "events"` etc.
      // is OK to keep verbatim; everything else collapses to its shape.
      safe[k] = k === cmdName && typeof v === 'string' ? v : redactValue(v)
    }
    const json = JSON.stringify(safe)
    const max = config.otel.traces.maxDbStatementLength

    return json.length > max ? `${json.slice(0, max)}...` : json
  } catch {
    return cmdName
  }
}

// Replaces every primitive with a typeof marker so the shape of a filter is
// preserved (useful for "did our app query by _id or by email?") without
// leaking the literal value.
function redactValue(v: unknown): unknown {
  if (v === null) return null
  if (Array.isArray(v)) return v.map(redactValue)
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}

    for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
      out[k] = redactValue(vv)
    }

    return out
  }

  return `<${typeof v}>`
}

export function instrumentMongoClient(client: MongoClient): void {
  // Keep listening when only metrics are enabled — duration + error counters
  // are useful on their own; span creation against a no-op tracer is cheap.
  if (!config.otel.enabled) return
  if (!config.otel.traces.enabled && !config.otel.metrics.enabled) return

  const tracer: Tracer = getTracer('mongodb')
  const m = metricsRegistry()
  const inFlight = new Map<number, { span: Span; start: number }>()

  client.on('commandStarted', (event: CommandStartedEvent) => {
    const cmdName = event.commandName
    const dbName = event.databaseName
    const collection =
      typeof event.command?.[cmdName] === 'string' ? (event.command[cmdName] as string) : undefined

    const span = tracer.startSpan(`mongodb.${cmdName}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': DB_SYSTEM,
        'db.namespace': dbName,
        'db.operation.name': cmdName,
        'db.collection.name': collection,
        'db.query.text': statementFor(cmdName, event.command ?? {}),
        'server.address': (event as unknown as { address?: string }).address ?? undefined,
        'atlas.mongo.connection_id': (event as unknown as { connectionId?: number | string })
          .connectionId,
        'atlas.mongo.request_id': event.requestId,
      },
    })

    inFlight.set(event.requestId, { span, start: performance.now() })
  })

  client.on('commandSucceeded', (event: CommandSucceededEvent) => {
    const entry = inFlight.get(event.requestId)

    if (!entry) return
    inFlight.delete(event.requestId)
    const durationMs = performance.now() - entry.start

    entry.span.setAttribute('db.duration_ms', durationMs)
    entry.span.end()
    // Semconv: db.client.operation.duration is in seconds.
    m.dbClientOperationDuration.record(durationMs / 1_000, {
      'db.system': DB_SYSTEM,
      'db.operation.name': event.commandName,
    })
  })

  client.on('commandFailed', (event: CommandFailedEvent) => {
    const entry = inFlight.get(event.requestId)

    if (!entry) return
    inFlight.delete(event.requestId)
    const durationMs = performance.now() - entry.start

    entry.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: event.failure?.message ?? 'mongo command failed',
    })
    if (event.failure instanceof Error) {
      entry.span.recordException(event.failure)
    }
    entry.span.end()
    m.dbClientOperationDuration.record(durationMs / 1_000, {
      'db.system': DB_SYSTEM,
      'db.operation.name': event.commandName,
      'error.type': event.failure?.name ?? 'mongo_error',
    })
    m.dbClientErrors.add(1, {
      'db.system': DB_SYSTEM,
      'db.operation.name': event.commandName,
    })
  })
}
