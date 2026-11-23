import { accountFailure, accountSignal, signedIn, stillCurrent } from '../account-request.ts'
import { buildAtlasError } from '../atlas/error.ts'
import { requestContext } from '../auth/request-context.ts'
import { authSession } from '../auth-session.ts'
import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from '../client-version.ts'
import { beginGet, notModified, readJson } from '../conditional-get.ts'
import { backendFailure, tagRequest } from '../fetch-error.ts'

import type { SignedIn } from '../account-request.ts'
import type { AccountContext } from '../auth-session.ts'

export function teamIdFromUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return /^\/teams\/([a-f0-9]{24})(?:\/|$)/.exec(new URL(url, 'https://nuphos.ai').pathname)?.[1]
  } catch {
    return undefined
  }
}

let accountSource: () => Promise<AccountContext> = requestContext

/** `nuphos agent`'s host reads the token through the CLI rather than the keychain. */
export function setTokenSource(source: () => Promise<string | null>) {
  accountSource = async () => ({ ...authSession.context(), token: await source() })
}

/** The signed-in account agent requests go out as; throws when signed out. */
export function agentAccount(): Promise<SignedIn> {
  return signedIn(accountSource)
}

/**
 * A backend refusal of an agent route. IPC hands the renderer only an error's
 * message, so the message carries the backend's {code, details} the way
 * `buildAtlasError` writes them, for `parseAtlasError` to recover. Without the
 * code the renderer cannot tell a dead session (`unauthorized`) from any other
 * failure, and keeps polling instead of signing out.
 */
export class AtlasHttpError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(buildAtlasError(message, code, details).message)
    this.name = 'AtlasHttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export async function callJson<T>(
  method: string,
  route: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<T> {
  const account = await agentAccount()
  const headers: Record<string, string> = {
    authorization: `Bearer ${account.token}`,
    [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE,
  }
  const requestId = tagRequest(headers)
  const get = beginGet(account, method, route, headers)
  const init: RequestInit = { method, headers, signal: accountSignal(account, timeoutMs) }

  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  let res: Response

  try {
    res = await fetch(`${account.api}${route}`, init)
    stillCurrent(account)
  } catch (error) {
    throw backendFailure(accountFailure(account, error), route, requestId)
  }
  const unchanged = notModified(get, res)

  if (unchanged) return unchanged.value as T
  if (!res.ok) {
    let message = `HTTP ${String(res.status)}`
    let code: string | undefined
    let details: unknown

    try {
      const j = (await res.json()) as {
        error?: { message?: string; code?: string; details?: unknown }
      }

      if (j.error?.message) message = j.error.message
      if (j.error?.code) code = j.error.code
      if (j.error && 'details' in j.error) details = j.error.details
    } catch {
      // ignore
    }
    throw new AtlasHttpError(message, res.status, code, details)
  }
  if (res.status === 204) return undefined as T
  const value = await readJson<T>(get, res)

  stillCurrent(account)

  return value
}

export function teamQuery(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
}
