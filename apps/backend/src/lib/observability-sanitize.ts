export type Primitive = string | number | boolean | null

export type ObservabilityProperties = Record<string, unknown>

const MAX_STRING_LENGTH = 1_000
const REDACTED = '[REDACTED]'
const SECRET_KEY_WORD = /(authorization|cookie|secret|password|credential|bearer)/i
const SECRET_KEY_COMPOUND =
  /(private.?key|access.?key|api.?key|auth.?token|session.?token|refresh.?token|id.?token)/i

function isSecretKey(key: string): boolean {
  return SECRET_KEY_WORD.test(key) || SECRET_KEY_COMPOUND.test(key)
}

export function truncate(value: string, max = MAX_STRING_LENGTH): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `String(value)` on a plain object yields `[object Object]`, which is what an
 * upstream SDK rejection that is not an `Error` used to be logged as.
 *
 * Objects go through `sanitizeValue`, not straight through `JSON.stringify`:
 * the strings this builds end up in `AppError` messages that reach the client,
 * and no caller can know whether a rejection payload carries `{ apiKey: ... }`.
 * The opaque `[object Object]` used to hide that by accident — masking by key
 * keeps the message readable without restoring the leak.
 */
export function describeUnknown(value: unknown): string {
  // An Error has no enumerable own properties, so serializing it yields "{}";
  // its message is what every caller wants anyway. Taking it here also stops
  // normalizeError() from bouncing back into this function.
  if (value instanceof Error) return value.message || value.name
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return value.toString()
  }
  try {
    return JSON.stringify(sanitizeValue(value)) ?? '[unserializable]'
  } catch {
    return '[unserializable]'
  }
}

/** The most specific human-readable message an unknown rejection carries. */
export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.message === 'string' && value.message) return value.message

  return describeUnknown(value)
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/**
 * @returns a log-safe mirror of `value` whose shape follows the input's — a
 * primitive stays a primitive, an array stays an array, anything else becomes
 * a plain record — with secrets masked and long strings truncated.
 */
function sanitizeValue(
  value: unknown,
  depth = 0,
): Primitive | Primitive[] | Record<string, unknown> {
  if (value == null) return null
  if (typeof value === 'string') return truncate(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) return normalizeError(value)
  if (depth >= 3) return '[Object]'
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1) as Primitive)
  if (!isRecord(value)) return truncate(describeUnknown(value))

  const sanitized: Record<string, unknown> = {}

  for (const [key, child] of Object.entries(value)) {
    if (isSecretKey(key)) {
      sanitized[key] = REDACTED
      continue
    }
    sanitized[key] = sanitizeValue(child, depth + 1)
  }

  return sanitized
}

export function sanitizeProperties(
  properties: ObservabilityProperties | undefined,
): Record<string, Primitive | Primitive[]> {
  const sanitized: Record<string, Primitive | Primitive[]> = {}

  for (const [key, value] of Object.entries(properties ?? {})) {
    if (value === undefined) continue
    if (isSecretKey(key)) {
      sanitized[key] = REDACTED
      continue
    }
    const safe = sanitizeValue(value)

    if (
      typeof safe === 'string' ||
      typeof safe === 'number' ||
      typeof safe === 'boolean' ||
      safe === null
    ) {
      sanitized[key] = safe
    } else if (Array.isArray(safe)) {
      // Preserve arrays of primitives (e.g. tools_used) so PostHog can break
      // them down / filter per-element instead of as an opaque JSON blob.
      sanitized[key] = safe
    } else {
      sanitized[key] = truncate(JSON.stringify(safe))
    }
  }

  return sanitized
}

function requestIdFromHeaders(headers: unknown): string | undefined {
  const keys = ['x-amzn-requestid', 'x-amz-request-id', 'x-amz-id-2', 'x-request-id', 'request-id']

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    for (const key of keys) {
      const value = headers.get(key)

      if (value) return value
    }

    return undefined
  }

  if (!isRecord(headers)) return undefined
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>

  for (const key of keys) {
    const value = normalized[key]

    if (typeof value === 'string' && value) return value
  }

  return undefined
}

function errorResponseSummary(error: Record<string, unknown>): Record<string, Primitive> {
  const summary: Record<string, Primitive> = {}
  const responseBody = error.responseBody

  if (typeof responseBody === 'string' && responseBody) {
    const parsed = safeJsonParse(responseBody)

    if (isRecord(parsed)) {
      const nested = isRecord(parsed.error) ? parsed.error : parsed
      const code = nested.code ?? nested.type
      const status = nested.status
      const message = nested.message ?? parsed.message

      if (typeof code === 'string') summary.provider_error_code = truncate(code, 200)
      if (typeof status === 'string') summary.provider_error_status = truncate(status, 200)
      if (typeof message === 'string') summary.provider_error_message = truncate(message)
    } else {
      summary.provider_response_body = truncate(responseBody)
    }
  }
  const responseHeaders = error.responseHeaders
  const providerRequestId = requestIdFromHeaders(responseHeaders)

  if (providerRequestId) summary.provider_request_id = providerRequestId

  return summary
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const url = new URL(value)

    return `${url.origin}${url.pathname}`
  } catch {
    return truncate(value, 500)
  }
}

export function normalizeError(error: unknown): Record<string, Primitive> {
  if (error == null) return { error_message: 'Unknown error' }
  if (typeof error === 'string') return { error_message: truncate(error) }

  const record = isRecord(error) ? error : {}
  const name = error instanceof Error ? error.name : record.name
  const message = error instanceof Error ? error.message : record.message
  const metadata = isRecord(record.$metadata) ? record.$metadata : undefined
  const response = isRecord(record.response) ? record.response : undefined
  const cause = record.cause

  const normalized: Record<string, Primitive> = {
    error_name: typeof name === 'string' ? truncate(name, 200) : 'Error',
    error_message:
      typeof message === 'string' && message ? truncate(message) : truncate(describeUnknown(error)),
  }

  if (error instanceof Error && typeof error.stack === 'string') {
    normalized.error_stack = truncate(error.stack, 4_000)
  }

  const status =
    typeof record.statusCode === 'number'
      ? record.statusCode
      : typeof record.status === 'number'
        ? record.status
        : typeof metadata?.httpStatusCode === 'number'
          ? metadata.httpStatusCode
          : typeof response?.status === 'number'
            ? response.status
            : undefined

  if (status !== undefined) normalized.error_status = status

  const requestId =
    typeof metadata?.requestId === 'string'
      ? metadata.requestId
      : requestIdFromHeaders(record.responseHeaders)

  if (requestId) normalized.provider_request_id = requestId

  const url = safeUrl(record.url)

  if (url) normalized.provider_url = url

  if (typeof record.retryable === 'boolean') normalized.retryable = record.retryable
  if (typeof record.code === 'string') normalized.provider_error_code = truncate(record.code, 200)

  Object.assign(normalized, errorResponseSummary(record))

  if (isRecord(cause)) {
    const causeName = cause.name
    const causeMessage = cause.message

    if (typeof causeName === 'string') normalized.cause_name = truncate(causeName, 200)
    if (typeof causeMessage === 'string') normalized.cause_message = truncate(causeMessage)
  }

  return normalized
}
