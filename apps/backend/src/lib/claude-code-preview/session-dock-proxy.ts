// A page on the owner's Mac or its network (a dev server on localhost), opened
// in the iPhone's own browser: each request its page makes is one `local_browser`
// `fetch` down the owner's device tunnel, fetched on the Mac, which only answers
// for local hosts one of the conversation's dock tabs is on. Owner only, like the
// rest of the dock; audited once per page the phone opens, not per asset.
import { AppError } from '@/lib/errors'

import { createDeviceToolHandler } from './preview-tools/device-tool'
import { quietDeps, requireOwnConversation, resultText } from './session-browser-tabs'

import type { DeviceTool, DeviceToolDeps } from './preview-tools/device-tool'

/** A request of the phone's page; `document` is the page itself, the one that is audited. */
export type DockFetchRequest = {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  document: boolean
}

export type DockFetchResponse = {
  status: number
  url: string
  headers: Record<string, string>
  body: string
}

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
const MAX_URL = 4096
const MAX_HEADERS = 32
/** The Mac takes 4 MiB of body; base64 is a third longer. */
const MAX_BODY_CHARS = Math.ceil((4 * 1024 * 1024 * 4) / 3) + 4

/** Why a request can't go to the Mac, or undefined if it can. */
export function invalidDockFetch(request: Partial<DockFetchRequest>): string | undefined {
  if (
    typeof request.url !== 'string' ||
    request.url.length > MAX_URL ||
    !/^https?:\/\//iu.test(request.url)
  )
    return 'url must be an http(s) URL.'
  if (typeof request.method !== 'string' || !METHODS.has(request.method.toUpperCase()))
    return 'Unsupported method.'
  const headers = Object.entries(request.headers ?? {})

  if (headers.length > MAX_HEADERS || headers.some(([, value]) => typeof value !== 'string'))
    return 'headers must be a few strings.'
  if (
    request.body !== undefined &&
    (typeof request.body !== 'string' || request.body.length > MAX_BODY_CHARS)
  )
    return 'The request body is too large.'

  return undefined
}

const proxyTool: DeviceTool = {
  name: 'local_browser',
  label: 'The dock',
  purpose: 'browser',
  invalid: (raw) => invalidDockFetch(raw as Partial<DockFetchRequest>),
  frame: (raw, ctx) => {
    const { url, method, headers, body } = raw as DockFetchRequest

    return { action: 'fetch', team: ctx.teamId, url, method, headers, ...(body ? { body } : {}) }
  },
  audit: (raw) => `[browser] phone open ${(raw as DockFetchRequest).url}`,
  errorReason: 'browser_error',
  noDevice: 'No computer of yours is online for this conversation.',
  unsupported: 'The computer went offline, or its Nuphos Desktop needs an update.',
}

/** Fetches one request of the phone's page from the owner's Mac. */
export async function fetchThroughDock(
  teamId: string,
  userId: string,
  sessionId: string,
  request: DockFetchRequest,
  deps: DeviceToolDeps = quietDeps,
): Promise<DockFetchResponse> {
  await requireOwnConversation(teamId, userId, sessionId)
  // A page's own assets are the page: one audit row for it, not one per script.
  const quiet = request.document ? deps : { ...deps, audit: async () => {} }
  const result = await createDeviceToolHandler(
    { userId, teamId, sessionId, locale: 'en' },
    proxyTool,
    quiet,
  )(request)

  if (result.isError) throw new AppError(502, 'mac_fetch_failed', resultText(result))

  return JSON.parse(resultText(result)) as DockFetchResponse
}
