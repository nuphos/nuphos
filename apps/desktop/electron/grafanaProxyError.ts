// Grafana answers /api/ds/query with the full per-refId result set even when
// the HTTP status is an error — 400 by default, 207 with the
// datasourceQueryMultiStatus toggle — so the status alone says nothing about
// which query failed. Hand such a body back to the caller, which reads the
// per-refId status/error; everything else becomes a short message.

export type GrafanaProxyFailure =
  { kind: 'query-results'; body: unknown } | { kind: 'error'; message: string }

const MAX_MESSAGE = 300
const MAX_KEYS = 12
const MAX_KEY = 40

export function classifyGrafanaFailure(status: number, text: string): GrafanaProxyFailure {
  const body = parseJson(text)

  if (isQueryDataResponse(body)) return { kind: 'query-results', body }

  const message = readMessage(body)

  if (message) return { kind: 'error', message }

  const line = body === undefined ? plainTextLine(text) : ''

  return {
    kind: 'error',
    message: line ? `HTTP ${String(status)}: ${line}` : `HTTP ${String(status)}`,
  }
}

export type GrafanaBodySummary = {
  status: number
  bytes: number
  shape: 'empty' | 'json-object' | 'json-array' | 'markup' | 'text'
  keys?: string[]
}

// A failed proxy call is logged, and a Grafana error body can carry datasource
// connection strings or query expressions with embedded credentials. Describe
// the body's shape instead: enough to tell a truncated payload from a gateway
// page, with no value ever read out of it.
export function summarizeGrafanaBody(status: number, text: string): GrafanaBodySummary {
  const summary: GrafanaBodySummary = { status, bytes: text.length, shape: shapeOf(text) }
  const body = parseJson(text)

  if (isRecord(body)) summary.keys = Object.keys(body).slice(0, MAX_KEYS).map(clampKey)

  return summary
}

function shapeOf(text: string): GrafanaBodySummary['shape'] {
  const trimmed = text.trim()

  if (!trimmed) return 'empty'
  if (trimmed.startsWith('<')) return 'markup'
  const body = parseJson(trimmed)

  if (Array.isArray(body)) return 'json-array'
  if (isRecord(body)) return 'json-object'

  return 'text'
}

function clampKey(key: string): string {
  return key.length <= MAX_KEY ? key : `${key.slice(0, MAX_KEY)}…`
}

function parseJson(text: string): unknown {
  const trimmed = text.trim()

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

function isQueryDataResponse(body: unknown): boolean {
  if (!isRecord(body) || !isRecord(body.results)) return false
  const results = Object.values(body.results)

  return results.length > 0 && results.every((r) => isRecord(r))
}

function readMessage(body: unknown): string {
  if (!isRecord(body)) return ''
  const err = body.error

  if (typeof err === 'string' && err.trim()) return clamp(err)
  if (isRecord(err) && typeof err.message === 'string' && err.message.trim()) {
    return clamp(err.message)
  }
  if (typeof body.message === 'string' && body.message.trim()) return clamp(body.message)

  return ''
}

// Only for bodies that are not serialized data: a gateway's `Bad Gateway`, an
// upstream connect error. Anything markup- or JSON-shaped is dropped.
function plainTextLine(text: string): string {
  const trimmed = text.trim()

  if (!trimmed || /^[{[<]/.test(trimmed)) return ''

  return clamp(trimmed.split('\n')[0] ?? '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  if (flat.length <= MAX_MESSAGE) return flat

  return `${flat.slice(0, MAX_MESSAGE - 1).trimEnd()}…`
}
