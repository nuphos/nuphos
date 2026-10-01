// log.ts — structured logging that flows through OTel's logs SDK so each
// record is automatically stamped with the active span's trace_id/span_id and
// shipped to the same OTLP endpoint as traces and metrics.
//
// We mirror everything to stdout in JSON-lines form so:
//   - kubectl logs / docker logs continue to work even if the exporter fails
//   - local dev sees structured output without needing a collector running
//
// Use this in place of `console.*` for anything you want correlated with a
// trace. `console.*` still works — we don't monkey-patch it.

import { context, trace } from '@opentelemetry/api'
import { SeverityNumber } from '@opentelemetry/api-logs'

import { config } from '@/config'
import { errorMessage } from '@/lib/observability'
import { getLogger } from '@/otel/api'

import type { SpanContext } from '@opentelemetry/api'
import type { LogRecord, Logger } from '@opentelemetry/api-logs'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
}

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
}

type LogAttributes = Record<string, unknown>

function activeSpanContext(): SpanContext | undefined {
  const ctx = trace.getSpanContext(context.active())

  return ctx?.traceId && ctx.traceId !== '00000000000000000000000000000000' ? ctx : undefined
}

function normalizeError(err: unknown): LogAttributes {
  if (err instanceof Error) {
    return {
      'exception.type': err.name,
      'exception.message': err.message,
      'exception.stacktrace': err.stack,
    }
  }
  if (err !== undefined) return { 'exception.message': errorMessage(err) }

  return {}
}

let _logger: Logger | undefined

function logger() {
  if (!_logger) _logger = getLogger('log')

  return _logger
}

function shouldEmit(level: LogLevel): boolean {
  const min = (LEVEL_ORDER[(config.otel.logs.level as LogLevel) ?? 'info'] ??
    LEVEL_ORDER.info) as number

  return LEVEL_ORDER[level] >= min
}

function emit(level: LogLevel, message: string, attrs?: LogAttributes, err?: unknown): void {
  if (!shouldEmit(level)) return

  const span = activeSpanContext()
  const merged: LogAttributes = {
    ...(attrs ?? {}),
    ...normalizeError(err),
  }

  if (config.otel.enabled && config.otel.logs.enabled) {
    const record: LogRecord = {
      severityNumber: SEVERITY[level],
      severityText: level.toUpperCase(),
      body: message,
      attributes: merged as Record<string, string | number | boolean>,
    }

    try {
      logger().emit(record)
    } catch (logErr) {
      // Never let a logging failure crash a request handler.
      console.error(
        safeJson({
          ts: new Date().toISOString(),
          level: 'error',
          event: 'otel.log.emit_failed',
          ...normalizeError(logErr),
        }),
      )
    }
  }

  if (config.otel.logs.console || !config.otel.enabled) {
    // Single-line JSON keeps log shippers happy and is easy to grep.
    const out = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...(span ? { trace_id: span.traceId, span_id: span.spanId } : {}),
      ...merged,
    }
    const line = safeJson(out)

    if (level === 'error' || level === 'fatal') {
      console.error(line)
    } else if (level === 'warn') {
      console.warn(line)
    } else {
      console.log(line)
    }
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    // Fall back to a best-effort replacer that drops circular refs.
    const seen = new WeakSet<object>()

    return JSON.stringify(value, (_, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]'
        seen.add(v)
      }
      if (typeof v === 'bigint') return v.toString()

      return v
    })
  }
}

export const log = {
  debug: (msg: string, attrs?: LogAttributes) => {
    emit('debug', msg, attrs)
  },
  info: (msg: string, attrs?: LogAttributes) => {
    emit('info', msg, attrs)
  },
  warn: (msg: string, attrs?: LogAttributes, err?: unknown) => {
    emit('warn', msg, attrs, err)
  },
  error: (msg: string, attrs?: LogAttributes, err?: unknown) => {
    emit('error', msg, attrs, err)
  },
  fatal: (msg: string, attrs?: LogAttributes, err?: unknown) => {
    emit('fatal', msg, attrs, err)
  },
  // Returns a child logger that injects fixed attributes on every record. Cheap
  // to call — we just close over the base attrs.
  child: (base: LogAttributes) => ({
    debug: (msg: string, attrs?: LogAttributes) => {
      emit('debug', msg, { ...base, ...attrs })
    },
    info: (msg: string, attrs?: LogAttributes) => {
      emit('info', msg, { ...base, ...attrs })
    },
    warn: (msg: string, attrs?: LogAttributes, err?: unknown) => {
      emit('warn', msg, { ...base, ...attrs }, err)
    },
    error: (msg: string, attrs?: LogAttributes, err?: unknown) => {
      emit('error', msg, { ...base, ...attrs }, err)
    },
    fatal: (msg: string, attrs?: LogAttributes, err?: unknown) => {
      emit('fatal', msg, { ...base, ...attrs }, err)
    },
  }),
}
