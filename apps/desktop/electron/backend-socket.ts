import { subscribe } from 'node:diagnostics_channel'

import { captureMain } from './analytics.ts'

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

let lastFailure = ''

/** The one way this app opens a WebSocket to its backend. `url` may be http(s) or ws(s). */
export function dialBackend(url: URL | string, headers: Record<string, string>): WebSocket {
  const target = new URL(String(url).replace(/^http/u, 'ws'))

  connectErrors.delete(target.hostname)
  const socket = new WebSocket(target, { headers })
  let opened = false

  socket.addEventListener('open', () => {
    opened = true
    lastFailure = ''
  })
  socket.addEventListener('error', () => {
    if (opened) return
    const failure: DialFailure = {
      host: target.host,
      code: connectErrors.get(target.hostname) ?? 'handshake_rejected',
    }
    const signature = JSON.stringify(failure)

    // A tunnel redials every few seconds; report each distinct failure once until a dial succeeds.
    if (signature === lastFailure) return
    lastFailure = signature
    console.warn('[backend-socket] dial failed', failure)
    captureMain('backend_socket_dial_failed', failure)
  })

  return socket
}
