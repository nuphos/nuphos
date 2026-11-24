import { subscribe } from 'node:diagnostics_channel'

import { ProxyAgent, Socks5ProxyAgent } from 'undici'

import { captureMain } from './analytics.ts'

import type { Dispatcher } from 'undici'

type DialFailure = {
  host: string
  /** `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`, …, or `handshake_rejected` when the server answered without upgrading. */
  code: string
}

// The WebSocket error event carries no cause; undici reports it on this channel.
const connectErrors = new Map<string, string>()

subscribe('undici:client:connectError', (message) => {
  const { connectParams, error } = message as {
    connectParams: { hostname: string }
    error: NodeJS.ErrnoException
  }

  connectErrors.set(connectParams.hostname, error.code ?? error.name)
})

// Nor does it carry the status of a handshake the server answered without upgrading.
const refusals = new Map<string, number>()

subscribe('undici:request:headers', (message) => {
  const { request, response } = message as {
    request: { origin: string; path: string }
    response: { statusCode: number }
  }
  const dialed = new URL(request.origin).host + request.path

  if (refusals.has(dialed)) refusals.set(dialed, response.statusCode)
})

let lastFailure = ''

/**
 * Chromium's proxy for a URL, as a PAC result such as `PROXY 127.0.0.1:7890; DIRECT`.
 * Node's WebSocket ignores the system proxy, so without this the tunnel dialed
 * around a VPN the window used, and on networks that only work through it the
 * computer kept dropping offline while chat worked.
 */
let resolveProxy: ((url: string) => Promise<string>) | undefined
/** The last proxy Chromium gave for each host; a dial uses it and asks again for the next one. */
const proxyRules = new Map<string, string>()
/** Which entry of that host's PAC result the next dial uses; a dial that cannot connect moves on. */
const proxyTries = new Map<string, number>()
/** One agent per proxy, kept open: a tunnel still on it must not be cut when the rule changes. */
const proxyAgents = new Map<string, Dispatcher | undefined>()

function agentFor(scheme: string, hostPort: string): Dispatcher | undefined {
  if (scheme === 'PROXY') return new ProxyAgent(`http://${hostPort}`)
  if (scheme === 'HTTPS') return new ProxyAgent(`https://${hostPort}`)
  if (scheme === 'SOCKS5') return new Socks5ProxyAgent(`socks5://${hostPort}`)

  return undefined
}

/** The entries of a PAC result that can be dialed, in order; SOCKS4, which undici lacks, is skipped. */
function proxyEntries(rule: string): string[] {
  const entries = rule
    .split(';')
    .map((entry) => entry.trim().replace(/\s+/gu, ' '))
    .filter((entry) => entry === 'DIRECT' || /^(PROXY|HTTPS|SOCKS5) \S+$/u.test(entry))

  return entries.length > 0 ? entries : ['DIRECT']
}

/** A PAC entry as a dispatcher; `DIRECT` has none. */
function proxyAgent(entry: string): Dispatcher | undefined {
  const [scheme = '', hostPort] = entry.split(' ')

  if (!hostPort) return undefined
  if (!proxyAgents.has(entry)) proxyAgents.set(entry, agentFor(scheme, hostPort))

  return proxyAgents.get(entry)
}

/** Looks up the proxy for `url` again, so the next dial follows a VPN switched on or off. */
async function refreshBackendProxy(url: URL | string): Promise<void> {
  if (!resolveProxy) return
  const target = new URL(String(url).replace(/^ws/u, 'http'))

  const rule = await resolveProxy(target.href).catch(() => 'DIRECT')

  // A new answer starts again from its first entry.
  if (proxyRules.get(target.host) !== rule) proxyTries.delete(target.host)
  proxyRules.set(target.host, rule)
}

type ProxySession = {
  resolveProxy: (url: string) => Promise<string>
  forceReloadProxyConfig: () => Promise<void>
}

/**
 * Dials backend WebSockets through `session`'s proxy from now on. Resolves once the proxy
 * for `api` is known, so the tunnel's first dial can wait for it: Chromium answers DIRECT
 * until its proxy config has loaded. A PAC script that never answers must not keep the
 * computer offline, so it resolves after `waitMs` regardless.
 */
export function routeBackendSocketsThroughSystemProxy(
  session: ProxySession,
  api: string,
  waitMs = 3000,
): Promise<void> {
  resolveProxy = (url) => session.resolveProxy(url)
  const known = session
    .forceReloadProxyConfig()
    .catch(() => undefined)
    .then(() => refreshBackendProxy(api))

  return Promise.race([known, new Promise<void>((resolve) => setTimeout(resolve, waitMs))])
}

/**
 * The one way this app opens a WebSocket to its backend. `url` may be http(s) or ws(s).
 * `onRefused` gets the status the server answered with instead of upgrading.
 */
export function dialBackend(
  url: URL | string,
  headers: Record<string, string>,
  onRefused?: (status: number) => void,
): WebSocket {
  const target = new URL(String(url).replace(/^http/u, 'ws'))
  const dialed = target.host + target.pathname + target.search

  connectErrors.delete(target.hostname)
  refusals.set(dialed, 0)
  const entries = proxyEntries(proxyRules.get(target.host) ?? 'DIRECT')
  const tried = (proxyTries.get(target.host) ?? 0) % entries.length
  const dispatcher = proxyAgent(entries[tried] ?? 'DIRECT')
  // undici's own Dispatcher type and the copy bundled with @types/node differ only in typings.
  const init = (dispatcher ? { headers, dispatcher } : { headers }) as unknown as WebSocketInit
  const socket = new WebSocket(target, init)

  void refreshBackendProxy(target)
  let opened = false

  socket.addEventListener('open', () => {
    opened = true
    lastFailure = ''
    refusals.delete(dialed)
  })
  socket.addEventListener('error', () => {
    if (opened) return
    const status = refusals.get(dialed)

    refusals.delete(dialed)
    if (status) onRefused?.(status)
    // No answer from the backend: this proxy may be the one that is down, so the next dial
    // uses the next entry. A backend that answered was reached, and the proxy stays.
    else proxyTries.set(target.host, tried + 1)
    const failure: DialFailure = {
      host: target.host,
      code: connectErrors.get(target.hostname) ?? 'handshake_rejected',
    }
    const signature = JSON.stringify(failure)

    // A tunnel redials every few seconds; report each distinct failure once until a dial succeeds.
    if (signature === lastFailure) return
    lastFailure = signature
    console.warn('[backend-socket] dial failed', failure)
    captureMain('backend_socket_dial_failed', { ...failure, $process_person_profile: false })
  })

  return socket
}
