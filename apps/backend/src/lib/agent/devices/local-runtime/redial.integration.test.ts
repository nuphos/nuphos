import { connect, createServer } from 'node:net'

import { afterEach, expect, spyOn, test } from 'bun:test'

import { RuntimeTunnelClient } from '../../../../../../desktop/electron/main/local-runtime/tunnel-client.ts'

import { localRuntimeUrl } from './address'
import { createLocalTunnelBus } from './bus'
import { attachRuntimeTunnel } from './holder'
import { createMemoryPresenceStore } from './presence'
import { openLocalRuntimeSocket } from './socket'

import type { RuntimeTunnel } from './holder'
import type { SocketLike } from '../../../../../../desktop/electron/main/local-runtime/tunnel-client.ts'
import type { Socket } from 'node:net'

const owner = { userId: 'u1', deviceId: 'd1', provider: 'claude-code' as const }

/** One backend WebSocket: its tunnel once attached, and frames that came before. */
type Peer = { tunnel?: RuntimeTunnel; queued: string[]; id: number }
const cleanup: (() => void)[] = []

afterEach(() => {
  for (const done of cleanup.splice(0).reverse()) done()
})

async function eventually(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const started = Date.now()

  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** A TCP hop whose open connections can stop passing what the backend sends, as a bad path does. */
async function proxyTo(port: number) {
  const pairs = new Set<{ client: Socket; silent: boolean }>()
  const server = createServer((client) => {
    const pair = { client, silent: false }
    const upstream = connect(port, '127.0.0.1')

    pairs.add(pair)
    client.on('data', (chunk) => upstream.write(chunk))
    upstream.on('data', (chunk) => {
      if (!pair.silent && !client.destroyed) client.write(chunk)
    })
    const end = () => {
      pairs.delete(pair)
      client.destroy()
      upstream.destroy()
    }

    client.on('close', end).on('error', end)
    upstream.on('close', end).on('error', end)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => server.close())

  return {
    port: (server.address() as { port: number }).port,
    silenceOpenConnections: () => {
      for (const pair of pairs) pair.silent = true
    },
    /** Resets the computer's side of open connections; the backend's side hears nothing. */
    resetOpenConnections: () => {
      for (const pair of pairs) {
        pairs.delete(pair)
        pair.client.removeAllListeners('close').destroy()
      }
    },
  }
}

/** The agent runtime behind the computer's tunnel: it echoes every frame. */
function echoRuntime(): SocketLike {
  const listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()
  const emit = (type: string, event: { data?: unknown } = {}) => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  const socket = {
    readyState: 0,
    addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    send: (data: string) => queueMicrotask(() => emit('message', { data: `echo:${data}` })),
    close: () => {
      socket.readyState = 3
      emit('close')
    },
  }

  setTimeout(() => {
    socket.readyState = 1
    emit('open')
  })

  return socket
}

/** A backend holding the computer's tunnels behind a proxy, and the computer dialing through it. */
async function startComputer() {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  const tunnels: string[] = [] // each backend tunnel's opening and how it ended, in order
  let opened = 0
  const backend = Bun.serve<Peer>({
    port: 0,
    fetch: (request, server) =>
      server.upgrade(request, { data: { queued: [], id: 0 } })
        ? undefined
        : new Response('', { status: 400 }),
    websocket: {
      async open(ws) {
        ws.data.id = ++opened
        tunnels.push(`open ${String(ws.data.id)}`)
        ws.data.tunnel = await attachRuntimeTunnel(
          owner.userId,
          owner.deviceId,
          {
            send: (frame) => ws.send(JSON.stringify(frame)),
            close: (code, reason) => {
              tunnels.push(`close ${String(ws.data.id)} ${String(code)}`)
              ws.close(code, reason)
            },
          },
          { bus, presence, isMember: async () => true, heartbeatMs: 2_000 },
        )
        for (const raw of ws.data.queued.splice(0)) ws.data.tunnel.receive(raw)
      },
      message(ws, raw) {
        if (ws.data.tunnel) ws.data.tunnel.receive(String(raw))
        else ws.data.queued.push(String(raw))
      },
      close(ws, code, reason) {
        ws.data.tunnel?.closed(code, reason)
      },
    },
  })

  cleanup.push(() => void backend.stop(true))
  const proxy = await proxyTo(Number(backend.port))
  const computer = new RuntimeTunnelClient({
    connectBackend: () => new WebSocket(`ws://127.0.0.1:${String(proxy.port)}/`),
    connectRuntime: () => echoRuntime(),
    status: () => ({ agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } } }),
  })

  computer.start()
  cleanup.push(() => computer.stop())
  const warnings = spyOn(console, 'warn')

  cleanup.push(() => warnings.mockRestore())
  await eventually(() => opened === 1 && tunnels.length === 1)
  await eventually(async () => (await presence.get(owner.userId, owner.deviceId)) !== null)
  const failures = () =>
    warnings.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('agent.local_runtime.stream_failed'))

  return { bus, presence, tunnels, proxy, failures }
}

test('a computer whose path goes silent redials, and a turn reattaching across it never fails', async () => {
  const { bus, presence, tunnels, proxy, failures } = await startComputer()

  // A turn's stream, reopened soon after it closes, as a session reattaches.
  const turn = { socket: undefined as ReturnType<typeof openLocalRuntimeSocket> | undefined }
  const replies: string[] = []
  const closes: string[] = []
  let reattaching = true
  const reopen = () => {
    const socket = openLocalRuntimeSocket(
      localRuntimeUrl(owner, 't1'),
      ['openab.bearer.transport', 'acp.v1'],
      { bus, presence, livenessMs: 60_000, closeRetryMs: 5 },
    )

    turn.socket = socket
    socket.addEventListener('message', (event) => replies.push(String(event.data)))
    socket.addEventListener('close', (event) => {
      if (turn.socket !== socket || !reattaching) return
      closes.push(event.reason ?? '')
      // Retried shortly after, a bounded number of times, as a session's reattach is.
      if (closes.length < 20) setTimeout(reopen, 100)
    })
  }

  reopen()
  await eventually(() => turn.socket?.readyState === 1)
  turn.socket?.send('before')
  await eventually(() => replies.includes('echo:before'))

  // The backend's frames stop arriving, so the computer gives the socket up after its idle
  // timeout and redials. The new tunnel comes up beside the old one before taking it over.
  proxy.silenceOpenConnections()
  await eventually(() => tunnels.includes('close 1 4000'))
  expect(tunnels.slice(0, 3)).toEqual(['open 1', 'open 2', 'close 1 4000'])

  // The takeover ended the turn's stream on the old tunnel, and its reattach found the new one.
  // (Giving the socket up also closes the computer's end of its streams, so a reattach may land
  // on the old tunnel first; the takeover moves it on.) No attempt failed on the way.
  await eventually(() => turn.socket?.readyState === 1)
  turn.socket?.send('after')
  await eventually(() => replies.includes('echo:after'))
  reattaching = false
  expect(closes.length).toBeGreaterThan(0)
  expect(failures()).toEqual([])
}, 40_000)

// #3648: a reset path. The computer's socket dies at once and it redials within a second, while
// the backend still holds the old tunnel, so a turn started in that second opens on a dead one.
test('a turn started while a reset tunnel redials opens on the new one, and nothing fails', async () => {
  const { bus, presence, tunnels, proxy, failures } = await startComputer()

  proxy.resetOpenConnections()
  const socket = openLocalRuntimeSocket(
    localRuntimeUrl(owner, 't1'),
    ['openab.bearer.transport', 'acp.v1'],
    { bus, presence, livenessMs: 60_000, closeRetryMs: 5 },
  )
  const replies: string[] = []
  const closes: string[] = []

  socket.addEventListener('message', (event) => replies.push(String(event.data)))
  socket.addEventListener('close', (event) => closes.push(event.reason ?? ''))
  await eventually(() => tunnels.includes('close 1 4000') || closes.length > 0)
  expect(tunnels.slice(0, 3)).toEqual(['open 1', 'open 2', 'close 1 4000'])

  await eventually(() => socket.readyState === 1 || closes.length > 0)
  expect(closes).toEqual([])
  socket.send('hi')
  await eventually(() => replies.includes('echo:hi'))
  expect(failures()).toEqual([])
}, 40_000)
