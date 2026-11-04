// A page on this Mac or its network, opened on the owner's iPhone: each request
// the phone's page makes comes here over the device tunnel and is fetched from
// this Mac, as its in-app browser would. Only hosts that one of the
// conversation's dock tabs is on, and only local ones: this is a way to reach
// the Mac's own dev servers, not a general proxy.
import { session } from 'electron'

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

/** The body, read with a running cap: past it the read stops and the response is refused. */
async function cappedBody(response: Response): Promise<Buffer | null> {
  const reader = (response.body as ReadableStream<Uint8Array> | null)?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  if (!reader) return Buffer.alloc(0)
  for (;;) {
    const { done, value } = await reader.read()

    if (done) return Buffer.concat(chunks)
    size += value.length
    if (size > PROXY_MAX_BYTES) {
      await reader.cancel()

      return null
    }
    chunks.push(value)
  }
}

/** One request from the phone's page: fetched here, answered with status, headers and body. */
export async function proxyFetch(call: BrowserCall): Promise<CuaToolResult> {
  if (!call.url || !URL.canParse(call.url)) return failed('url must be an http(s) URL.')
  let url = new URL(call.url)
  const origins = await allowedOrigins(call)
  const refused = refusal(url, origins)

  if (refused) return failed(refused)
  const body = call.body ? Buffer.from(call.body, 'base64') : undefined

  if (body && body.length > PROXY_MAX_BYTES) return failed('The request body is too large.')
  const headers = Object.fromEntries(
    Object.entries(call.headers ?? {}).filter(([name]) => REQUEST_HEADERS.has(name.toLowerCase())),
  )
  let method = (call.method ?? 'GET').toUpperCase()
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)

  try {
    for (let hop = 0; ; hop++) {
      const response = await session.fromPartition('persist:browser').fetch(url.href, {
        method,
        headers,
        redirect: 'manual',
        ...(body && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
        signal,
      })
      const location = response.headers.get('location')

      // Each hop is checked like the first: a dock tab's host can't send the phone anywhere else.
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel()
        if (hop >= MAX_REDIRECTS) return failed('Too many redirects.')
        url = new URL(location, url)
        const elsewhere = refusal(url, origins)

        if (elsewhere) return failed(`The page redirected away: ${elsewhere}`)
        if (response.status === 303 || method === 'POST') method = 'GET'
        continue
      }
      const data = await cappedBody(response)

      if (!data) return failed('The response is more than 4 MB, more than the phone can be sent.')

      return text({
        status: response.status,
        url: url.href,
        headers: Object.fromEntries(
          [...response.headers].filter(([name]) => RESPONSE_HEADERS.has(name.toLowerCase())),
        ),
        body: data.toString('base64'),
      })
    }
  } catch (error) {
    return failed(
      `Couldn't reach ${url.host} from this Mac: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
