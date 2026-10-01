// redis.ts — wraps an ioredis client so every command produces a span +
// duration histogram. ioredis exposes a stable `sendCommand(command)` entry
// point that *every* command (and pipelined command) flows through, so a
// single patch covers GET/SET, EVAL, ZADD, pubsub, sentinel chatter — the lot.

import { SpanKind, SpanStatusCode } from '@opentelemetry/api'

import { config } from '@/config'
import { getTracer } from '@/otel/api'
import { metricsRegistry } from '@/otel/metrics'

import type Redis from 'ioredis'

const DB_SYSTEM = 'redis'

// Privacy-first: by default we record only the command name on the span.
// Arguments often contain values that are sensitive (SET keys, EVAL scripts,
// HSET fields, AUTH tokens). When OTEL_DB_CAPTURE_STATEMENT=true, we capture
// the key (first arg, which is structural) but mask the remaining argument
// values so the shape of the call is preserved without leaking payloads.
function statementFor(name: string, args: unknown[]): string | undefined {
  if (!config.otel.traces.captureDbStatement) return undefined
  if (!args?.length) return name
  try {
    const argTexts = args.map((a, i) => {
      // First arg is conventionally the key; safe to expose at a high level,
      // but still capped at a short length so a 1MB blob can't sneak in.
      if (i === 0) {
        const s = Buffer.isBuffer(a) ? a.toString('utf8') : String(a)

        return s.length > 128 ? `${s.slice(0, 128)}...` : s
      }

      return '<arg>'
    })
    const flat = `${name} ${argTexts.join(' ')}`
    const max = config.otel.traces.maxDbStatementLength

    return flat.length > max ? `${flat.slice(0, max)}...` : flat
  } catch {
    return name
  }
}

type IoRedisCommand = {
  name: string
  args: unknown[]
  promise: Promise<unknown>
}

type SendCommand = (command: IoRedisCommand, ...rest: unknown[]) => Promise<unknown>

// Tagged once so a client passed in twice doesn't double-instrument.
const INSTRUMENTED = Symbol.for('atlas.otel.redis.instrumented')

export function instrumentRedis(
  client: Redis,
  opts: { role?: 'client' | 'subscriber' } = {},
): void {
  // Same rationale as mongo.ts: don't gate on traces alone, since
  // db.client.operation.duration is useful in metrics-only mode too.
  if (!config.otel.enabled) return
  if (!config.otel.traces.enabled && !config.otel.metrics.enabled) return
  const flagged = client as unknown as { [INSTRUMENTED]?: boolean }

  if (flagged[INSTRUMENTED]) return
  flagged[INSTRUMENTED] = true

  const tracer = getTracer('redis')
  const m = metricsRegistry()
  const original = (client as unknown as { sendCommand: SendCommand }).sendCommand.bind(client)

  ;(client as unknown as { sendCommand: SendCommand }).sendCommand = function patched(
    command,
    ...rest
  ) {
    const name = command.name?.toUpperCase?.() ?? 'UNKNOWN'
    const start = performance.now()
    const span = tracer.startSpan(`redis.${name.toLowerCase()}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': DB_SYSTEM,
        'db.operation.name': name,
        'db.query.text': statementFor(name, command.args ?? []),
        'atlas.redis.role': opts.role ?? 'client',
        'atlas.redis.db': config.redis.db,
      },
    })

    // ioredis returns a microtask-chained promise (so AsyncLocalStorage
    // already preserves context across .then), but `original()` itself can
    // throw synchronously — e.g. when called with malformed args or when the
    // offline queue is disabled and the socket is down. If we let that bubble
    // without intercepting, the span would never end and metrics never record.
    const recordFailure = (err: unknown) => {
      const durationMs = performance.now() - start

      if (err instanceof Error) span.recordException(err)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
      span.end()
      m.dbClientOperationDuration.record(durationMs / 1_000, {
        'db.system': DB_SYSTEM,
        'db.operation.name': name,
        'error.type': err instanceof Error ? err.name : 'redis_error',
      })
      m.dbClientErrors.add(1, {
        'db.system': DB_SYSTEM,
        'db.operation.name': name,
      })
    }

    let result: Promise<unknown>

    // eslint-disable-next-line sonarjs/no-try-promise -- the try guards only the synchronous throw described above; the rejection path is handled by the .then below
    try {
      result = original(command, ...rest)
    } catch (err) {
      recordFailure(err)
      throw err
    }

    result.then(() => {
      const durationMs = performance.now() - start

      span.setAttribute('db.duration_ms', durationMs)
      span.end()
      m.dbClientOperationDuration.record(durationMs / 1_000, {
        'db.system': DB_SYSTEM,
        'db.operation.name': name,
      })
    }, recordFailure)

    return result
  } as typeof original
}
