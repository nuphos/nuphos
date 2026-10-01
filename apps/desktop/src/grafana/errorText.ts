// Turns whatever a failed dashboard/panel request threw into a short line the
// user can read, plus the untouched original for the details disclosure.

export type QueryErrorText = {
  summary: string
  detail: string | null
}

const MAX_SUMMARY = 180

// `ipcRenderer.invoke` rejections arrive as
// `Error invoking remote method 'atlas:grafanaProxy': Error: <message>`.
const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*/
const ERROR_PREFIX = /^[A-Za-z]*Error:\s*/

const EMPTY_SUMMARY = 'Request failed.'
const UNREADABLE_SUMMARY = 'Request failed — the response carried no readable error message.'

export function queryErrorText(raw: string): QueryErrorText {
  const message = raw.replace(IPC_WRAPPER, '').replace(ERROR_PREFIX, '').trim()

  if (!message) return { summary: EMPTY_SUMMARY, detail: null }

  const body = parseBody(message)

  if (body !== undefined) {
    const extracted = extractMessage(body)

    return withDetail(extracted ? clamp(extracted) : UNREADABLE_SUMMARY, message)
  }

  const summary = clamp(message.split('\n')[0] ?? '')

  if (!summary) return { summary: EMPTY_SUMMARY, detail: message }
  if (looksSerialized(summary)) return { summary: UNREADABLE_SUMMARY, detail: message }

  return withDetail(summary, message)
}

function withDetail(summary: string, message: string): QueryErrorText {
  return { summary, detail: summary === message ? null : message }
}

function parseBody(message: string): unknown {
  if (!message.startsWith('{') && !message.startsWith('[')) return undefined
  try {
    return JSON.parse(message)
  } catch {
    return undefined
  }
}

function extractMessage(body: unknown): string | null {
  if (!isRecord(body)) return null

  const err = body.error

  if (typeof err === 'string' && err.trim()) return err.trim()
  if (isRecord(err) && typeof err.message === 'string' && err.message.trim()) {
    return err.message.trim()
  }
  if (typeof body.message === 'string' && body.message.trim()) return body.message.trim()

  // Grafana's /api/ds/query answers with per-refId results even when the HTTP
  // status is an error; the only human text lives on the failed ones.
  if (isRecord(body.results)) {
    const parts: string[] = []

    for (const [refId, result] of Object.entries(body.results)) {
      if (!isRecord(result)) continue
      const text = typeof result.error === 'string' ? result.error.trim() : ''

      if (text) parts.push(`Query ${refId} failed: ${text}`)
    }
    if (parts.length > 0) return parts.join('; ')
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function looksSerialized(text: string): boolean {
  return /[{[]\s*"/.test(text) || /"\s*:\s*[{["]/.test(text)
}

function clamp(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  if (flat.length <= MAX_SUMMARY) return flat

  return `${flat.slice(0, MAX_SUMMARY - 1).trimEnd()}…`
}
