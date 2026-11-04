// A page on this Mac or its network, opened on the owner's iPhone: each request
// the phone's page makes comes here over the device tunnel and is fetched from
// this Mac, as its in-app browser would. Only hosts that one of the
// conversation's dock tabs is on, and only local ones: this is a way to reach
// the Mac's own dev servers, not a general proxy.
import { net, session } from 'electron'

import { failed } from './cua-host.ts'
import { dockTabUrls } from './dock-mirror.ts'

import type { BrowserCall } from './browser-stream.ts'
import type { CuaToolResult } from './cua-host.ts'

/** The largest body either way; its base64 still fits one tunnel frame. */
export const PROXY_MAX_BYTES = 4 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000

/** Request headers the phone may pass on; the Mac's own session supplies cookies and the rest. */
const REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'if-none-match',
  'if-modified-since',
  'range',
])
/** Response headers the phone's page needs; never the Mac's cookies. */
const RESPONSE_HEADERS = new Set([
  'content-type',
  'cache-control',
  'etag',
  'last-modified',
  'content-range',
  'accept-ranges',
  'content-disposition',
])

/** Loopback, `.local`, or a private address: the Mac's own network, which the phone can't reach. */
export function isLocalHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/gu, '')

  if (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name.endsWith('.local') ||
    name === '::1'
  )
    return true
  const octets = name.split('.').map(Number)

  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet > 255))
    return false
  const [a = 0, b = 0] = octets

  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31)
  )
}

const text = (value: unknown): CuaToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
})

/** One request from the phone's page: fetched here, answered with status, headers and body. */
/** Redirects followed here, each re-checked against the conversation's dock. */
const MAX_REDIRECTS = 5

/**
 * The local addresses the phone may reach: the exact host and port of one of
 * the conversation's dock tabs. Not other ports: a page fetched this way skips
 * CORS, so a wider rule would let its scripts reach any service on that host.
 */
async function allowedOrigins(call: BrowserCall): Promise<Set<string>> {
  return new Set(
    (await dockTabUrls(call))
      .filter((tab) => URL.canParse(tab))
      .map((tab) => new URL(tab))
      .filter((tab) => isLocalHost(tab.hostname))
      .map((tab) => tab.origin),
  )
}

function refusal(url: URL, origins: Set<string>): string | undefined {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'url must be an http(s) URL.'
  if (!isLocalHost(url.hostname))
    return 'Only pages on this Mac or its network are fetched for the phone.'
  if (!origins.has(url.origin)) return `${url.host} is not in this conversation's dock.`

  return undefined
}

type Fetched = { status: number; url: string; headers: Record<string, string>; body: Buffer }

/**
 * One request through the in-app browser's session, with each redirect hop
 * checked before it is followed and the body read with a running cap. Not
 * `session.fetch`: under `redirect: 'manual'` it throws instead of answering.
 */
function sessionRequest(
  url: URL,
  init: { method: string; headers: Record<string, string>; body?: Buffer },
  origins: Set<string>,
): Promise<Fetched | { refused: string }> {
  return new Promise((resolve) => {
    let current = url
    let hops = 0
    let settled = false
    const finish = (result: Fetched | { refused: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const request = net.request({
      url: url.href,
      method: init.method,
      session: session.fromPartition('persist:browser'),
      useSessionCookies: true,
      redirect: 'manual',
    })
    const stop = (refused: string) => {
      request.abort()
      finish({ refused })
    }
    const timer = setTimeout(() => stop(`${url.host} did not answer in time.`), FETCH_TIMEOUT_MS)

    for (const [name, value] of Object.entries(init.headers)) request.setHeader(name, value)
    // Each hop is checked like the first: a dock tab's host can't send the phone anywhere else.
    request.on('redirect', (_status, _method, location) => {
      const next = new URL(location, current)
      const elsewhere = refusal(next, origins)

      if (++hops > MAX_REDIRECTS) return stop('Too many redirects.')
      if (elsewhere) return stop(`The page redirected away: ${elsewhere}`)
      current = next
      request.followRedirect()
    })
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      let size = 0

      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > PROXY_MAX_BYTES)
          stop('The response is more than 4 MB, more than the phone can be sent.')
        else chunks.push(chunk)
      })
      response.on('end', () =>
        finish({
          status: response.statusCode,
          url: current.href,
          headers: Object.fromEntries(
            Object.entries(response.headers).flatMap(([name, value]) =>
              RESPONSE_HEADERS.has(name.toLowerCase()) ? [[name, [value].flat().join(', ')]] : [],
            ),
          ),
          body: Buffer.concat(chunks),
        }),
      )
      response.on('error', (error: Error) =>
        stop(`Couldn't reach ${url.host} from this Mac: ${error.message}`),
      )
    })
    request.on('error', (error) =>
      stop(`Couldn't reach ${url.host} from this Mac: ${error.message}`),
    )
    if (init.body) request.write(init.body)
    request.end()
  })
}

/** One request from the phone's page: fetched here, answered with status, headers and body. */
export async function proxyFetch(call: BrowserCall): Promise<CuaToolResult> {
  if (!call.url || !URL.canParse(call.url)) return failed('url must be an http(s) URL.')
  const url = new URL(call.url)
  const origins = await allowedOrigins(call)
  const refused = refusal(url, origins)

  if (refused) return failed(refused)
  const body = call.body ? Buffer.from(call.body, 'base64') : undefined

  if (body && body.length > PROXY_MAX_BYTES) return failed('The request body is too large.')
  const headers = Object.fromEntries(
    Object.entries(call.headers ?? {}).filter(([name]) => REQUEST_HEADERS.has(name.toLowerCase())),
  )
  const method = (call.method ?? 'GET').toUpperCase()
  const fetched = await sessionRequest(
    url,
    { method, headers, ...(body && method !== 'GET' && method !== 'HEAD' ? { body } : {}) },
    origins,
  )

  if ('refused' in fetched) return failed(fetched.refused)

  return text({ ...fetched, body: fetched.body.toString('base64') })
}
