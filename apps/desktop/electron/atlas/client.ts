import { accountFailure, accountSignal, signedIn, stillCurrent } from '../account-request.ts'
import { apiUrl } from '../api-endpoint.ts'
import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from '../client-version.ts'
import { backendFailure, tagRequest } from '../fetch-error.ts'

import { buildAtlasError } from './error.ts'

import type { SignedIn } from '../account-request.ts'

/** Expose the resolved backend base URL to the renderer. Used by features
 *  that need to construct public URLs (e.g. webhook URLs in TriggersView). */
export function getApiUrl(): string {
  return apiUrl()
}

// Default per-request timeout. Multi-region sweeps (e.g. Aliyun ECS/SWAS across
// a large fleet) pass a longer timeoutMs — the backend bounds itself below it.
const DEFAULT_TIMEOUT_MS = 15_000

/** Fetches `route` on the account's backend, retrying failures until the account changes. */
export async function fetchWithRetry(
  account: SignedIn,
  route: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const attempts = 3
  const backoffMs = [500, 1500]
  let lastErr: unknown

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${account.api}${route}`, {
        ...init,
        signal: accountSignal(account, timeoutMs),
      })

      stillCurrent(account)

      return res
    } catch (e) {
      lastErr = accountFailure(account, e)
      if (account.signal.aborted) break
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, backoffMs[i]))
    }
  }
  throw lastErr
}

export async function call<T>(
  method: string,
  route: string,
  body?: unknown,
  opts?: { retry?: boolean; timeoutMs?: number },
): Promise<T> {
  const account = await signedIn()
  const headers: Record<string, string> = {
    authorization: `Bearer ${account.token}`,
    [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE,
  }
  const requestId = tagRequest(headers)
  const init: RequestInit = { method, headers }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
    headers['content-type'] = 'application/json'
  }
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let res: Response

  try {
    res =
      opts?.retry === false
        ? await fetch(`${account.api}${route}`, {
            ...init,
            signal: accountSignal(account, timeoutMs),
          })
        : await fetchWithRetry(account, route, init, timeoutMs)
    stillCurrent(account)
  } catch (e) {
    throw backendFailure(accountFailure(account, e), route, requestId)
  }
  if (!res.ok) {
    let message = `HTTP ${String(res.status)}`
    let code: string | undefined
    let details: unknown
    // Read as text first so a non-JSON body (proxy errors, plain-text 502s,
    // …) still surfaces something useful. Only try to parse JSON if the body
    // looks parseable; otherwise fall back to the raw text.
    const text = await res.text().catch(() => '')

    if (text) {
      try {
        const j = JSON.parse(text) as {
          error?: { message?: string; code?: string; details?: unknown }
        }

        if (j.error?.message) message = j.error.message
        code = j.error?.code
        details = j.error?.details
      } catch {
        message = text
      }
    }
    throw buildAtlasError(message, code, details)
  }
  if (res.status === 204) return undefined as T
  const value = (await res.json()) as T

  stillCurrent(account)

  return value
}

export async function callText(method: string, route: string): Promise<string> {
  const account = await signedIn()
  const headers: Record<string, string> = {
    authorization: `Bearer ${account.token}`,
    [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE,
  }
  const requestId = tagRequest(headers)
  let res: Response

  try {
    res = await fetchWithRetry(account, route, { method, headers })
  } catch (error) {
    throw backendFailure(error, route, requestId)
  }
  const text = await res.text()

  stillCurrent(account)
  if (!res.ok) throw new Error(text || `HTTP ${String(res.status)}`)

  return text
}

export async function callMultipart<T>(
  route: string,
  fields: Record<string, string>,
  file: { filename: string; bytes: Uint8Array; contentType?: string },
  opts?: { timeoutMs?: number },
): Promise<T> {
  const account = await signedIn()
  const form = new FormData()

  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value)
  }
  form.append(
    'file',
    new Blob([file.bytes], { type: file.contentType || 'application/octet-stream' }),
    file.filename,
  )
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const headers: Record<string, string> = {
    authorization: `Bearer ${account.token}`,
    [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE,
  }
  const requestId = tagRequest(headers)
  let res: Response

  try {
    res = await fetchWithRetry(account, route, { method: 'POST', headers, body: form }, timeoutMs)
  } catch (e) {
    throw backendFailure(e, route, requestId)
  }
  if (!res.ok) {
    let message = `HTTP ${String(res.status)}`
    let code: string | undefined
    let details: unknown
    const text = await res.text().catch(() => '')

    if (text) {
      try {
        const j = JSON.parse(text) as {
          error?: { message?: string; code?: string; details?: unknown }
        }

        if (j.error?.message) message = j.error.message
        code = j.error?.code
        details = j.error?.details
      } catch {
        message = text
      }
    }
    throw buildAtlasError(message, code, details)
  }
  if (res.status === 204) return undefined as T
  const value = (await res.json()) as T

  stillCurrent(account)

  return value
}

export function appendQuery(
  route: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value))
    }
  }
  const qs = query.toString()

  if (!qs) return route

  return `${route}${route.includes('?') ? '&' : '?'}${qs}`
}

export const withAwsRole = (route: string, roleId?: string): string =>
  appendQuery(route, { roleId })

export const withGcpServiceAccount = (route: string, serviceAccountId?: string): string =>
  appendQuery(route, { serviceAccountId })

// Defined in a leaf module so the agent HTTP client can share it; re-exported
// here because this is where callers already import it from (buildAtlasError is
// also used below, hence the import as well as the re-export).
export { ATLAS_ERROR_SENTINEL, buildAtlasError } from './error.ts'
