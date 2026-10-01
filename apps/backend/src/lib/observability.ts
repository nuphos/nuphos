import { normalizeError, sanitizeProperties } from '@/lib/observability-sanitize'

import type { ObservabilityProperties, Primitive } from '@/lib/observability-sanitize'
import type { Context } from 'hono'

export {
  describeUnknown,
  errorMessage,
  normalizeError,
  sanitizeProperties,
} from '@/lib/observability-sanitize'
export type { ObservabilityProperties } from '@/lib/observability-sanitize'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export function errorTelemetryProperties(error: unknown): Record<string, Primitive> {
  return normalizeError(error)
}

function contextValue(context: Context | undefined, key: string): string | undefined {
  if (!context) return undefined
  const value = (context as Context & { get(name: string): unknown }).get(key)

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requestContext(context: Context | undefined): Record<string, Primitive | Primitive[]> {
  if (!context) return {}

  return sanitizeProperties({
    request_id: contextValue(context, 'requestId'),
    user_id: contextValue(context, 'userId'),
    team_id: contextValue(context, 'teamId'),
    method: context.req.method,
    path: context.req.path,
  })
}

export function logEvent(
  level: LogLevel,
  event: string,
  properties?: ObservabilityProperties,
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitizeProperties(properties),
  }
  const line = JSON.stringify(payload)

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function logError(
  event: string,
  error: unknown,
  properties?: ObservabilityProperties & { context?: Context },
): void {
  logEvent('error', event, {
    ...normalizeError(error),
    ...requestContext(properties?.context),
    ...properties,
    context: undefined,
  })
}
