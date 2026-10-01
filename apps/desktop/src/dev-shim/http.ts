const ATLAS_ERROR_SENTINEL = '__ATLAS_API_ERROR__'

export function buildAtlasError(message: string, code?: string, details?: unknown): Error {
  if (code === undefined && details === undefined) return new Error(message)

  return new Error(`${ATLAS_ERROR_SENTINEL}${JSON.stringify({ message, code, details })}`)
}

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'content-type': 'application/json' }
  }
  const res = await fetch(`/atlas-api${path}`, init)

  if (!res.ok) {
    let msg = `HTTP ${String(res.status)}`
    let code: string | undefined
    let details: unknown

    try {
      const text = await res.text()

      try {
        const j = JSON.parse(text) as {
          error?: { message?: string; code?: string; details?: unknown }
        }

        msg = j.error?.message || text || msg
        code = j.error?.code
        details = j.error?.details
      } catch {
        if (text) msg = text
      }
    } catch {
      // ignore
    }
    throw buildAtlasError(msg, code, details)
  }
  if (res.status === 204) return undefined as T

  return (await res.json()) as T
}

export function appendQuery(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  const qs = query.toString()

  if (!qs) return path

  return `${path}${path.includes('?') ? '&' : '?'}${qs}`
}

export const noop = () => Promise.resolve(undefined as never)

export const empty = <T>(v: T) => Promise.resolve(v)
