import type { LocalAgentProvider } from './agent-cli.ts'
import type { LocalModelCatalog } from './model-probe.ts'

export type TunnelPurpose = 'transport' | 'control'

/** Lists only the agents running right now; the owner sees exactly these. */
export type LocalRuntimeTunnelStatus = {
  agents: Partial<
    Record<
      LocalAgentProvider,
      {
        cli: { installed: boolean; loggedIn: boolean | null }
        usage?: unknown
        usageAt?: string
        version?: string
        models?: LocalModelCatalog
      }
    >
  >
  backendUrl?: string
}

type BackendFrame =
  | {
      t: 'open'
      s: string
      purpose: TunnelPurpose | 'exec' | 'file' | 'terminal'
      provider?: LocalAgentProvider
    }
  | { t: 'data'; s: string; d: string }
  | { t: 'close'; s: string; reason?: string }
  | { t: 'ping' }

export type SocketEvent = { data?: unknown; code?: number }

export type SocketLike = {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  terminate?(): void
  addEventListener(type: string, listener: (event: SocketEvent) => void): void
}

export type TunnelClientDeps = {
  /** Opens the WebSocket to the backend's tunnel route, authenticated as the signed-in user. */
  connectBackend: () => SocketLike
  /** Opens one ACP WebSocket to that agent's loopback openab with the key for `purpose`. */
  connectRuntime: (purpose: TunnelPurpose, provider: LocalAgentProvider) => SocketLike | null
  connectFile?: () => SocketLike | null
  connectTerminal?: () => SocketLike
  connectExec?: () => SocketLike
  status: () => LocalRuntimeTunnelStatus
  /** `connected` is exactly whether Nuphos holds this computer's tunnel right now. */
  onChange?: (connected: boolean, superseded: boolean) => void
}

const OPEN = 1
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]

/** The backend pings every 5s; silence this long means the socket is dead. */
export const TUNNEL_IDLE_TIMEOUT_MS = 12_000
const CLOSE_SUPERSEDED = 4000

export function tunnelReconnectDelayMs(attempt: number): number {
  return RECONNECT_BACKOFF_MS[Math.min(Math.max(attempt, 0), RECONNECT_BACKOFF_MS.length - 1)]
}

function parseFrame(raw: unknown): BackendFrame | null {
  if (typeof raw !== 'string') return null
  try {
    const frame = JSON.parse(raw) as BackendFrame

    return typeof frame === 'object' && typeof frame.t === 'string' ? frame : null
  } catch {
    return null
  }
}

/**
 * Keeps exactly one tunnel to the backend open while started, reconnecting with
 * backoff whenever it closes, and relays each stream the backend opens to the
 * runtime on loopback. The runtime itself never listens beyond 127.0.0.1.
 */
export class RuntimeTunnelClient {
  private socket: SocketLike | undefined
  private readonly streams = new Map<string, { runtime: SocketLike; pending: string[] }>()
  private running = false
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private readonly deps: TunnelClientDeps

  constructor(deps: TunnelClientDeps) {
    this.deps = deps
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.attempt = 0
    this.connect()
  }

  stop(): void {
    this.running = false
    this.drop()
    this.deps.onChange?.(false, false)
  }

  /** Dials again now instead of waiting out the backoff, e.g. after the computer woke up. */
  reconnectNow(): void {
    if (!this.running) return
    this.drop()
    this.attempt = 0
    this.connect()
  }

  /** Re-announces the runtime's state, e.g. after the claude login changed. */
  sendStatus(): void {
    this.send({
      t: 'status',
      status: { ...this.deps.status(), localExec: Boolean(this.deps.connectExec), localTerminal: Boolean(this.deps.connectTerminal) },
    })
  }

  private drop(): void {
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.idleTimer)
    for (const { runtime } of this.streams.values()) runtime.close()
    this.streams.clear()
    const socket = this.socket

    this.socket = undefined
    if (socket?.terminate) socket.terminate()
    else socket?.close(1000, 'reconnecting')
  }

  private send(frame: object): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(frame))
  }

  private armIdle(socket: SocketLike): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (this.socket !== socket) return
      this.drop()
      this.deps.onChange?.(false, false)
      this.scheduleReconnect()
    }, TUNNEL_IDLE_TIMEOUT_MS)
  }

  private connect(): void {
    let socket: SocketLike

    try {
      socket = this.deps.connectBackend()
    } catch {
      this.scheduleReconnect()

      return
    }
    this.socket = socket
    this.armIdle(socket)
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.attempt = 0
      this.sendStatus()
      this.deps.onChange?.(true, false)
    })
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return
      this.armIdle(socket)
      const frame = parseFrame(event.data)

      if (frame) this.handle(frame)
    })
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return
      this.drop()
      const superseded = event.code === CLOSE_SUPERSEDED

      this.deps.onChange?.(false, superseded)
      if (superseded) this.running = false
      else this.scheduleReconnect()
    })
    socket.addEventListener('error', () => {
      if (this.socket !== socket) return
      this.drop()
      this.deps.onChange?.(false, false)
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (!this.running) return
    const delay = tunnelReconnectDelayMs(this.attempt)

    this.attempt += 1
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      if (this.running && !this.socket) this.connect()
    }, delay)
  }

  private handle(frame: BackendFrame): void {
    switch (frame.t) {
      case 'ping':
        this.send({ t: 'pong' })

        return
      case 'open':
        this.open(frame.s, frame.purpose, frame.provider ?? 'claude-code')

        return
      case 'data': {
        const stream = this.streams.get(frame.s)

        if (stream?.runtime.readyState === OPEN) stream.runtime.send(frame.d)
        else stream?.pending.push(frame.d)

        return
      }
      case 'close':
        this.streams.get(frame.s)?.runtime.close()
        this.streams.delete(frame.s)
    }
  }

  private open(
    s: string,
    purpose: TunnelPurpose | 'exec' | 'file' | 'terminal',
    provider: LocalAgentProvider,
  ): void {
    if (this.streams.has(s)) return
    const runtime =
      purpose === 'terminal'
        ? this.deps.connectTerminal?.()
        : purpose === 'file'
        ? this.deps.connectFile?.()
        : purpose === 'exec'
          ? this.deps.connectExec?.()
          : this.deps.connectRuntime(purpose, provider)

    if (!runtime) {
      this.send({ t: 'close', s, reason: 'The local agent is not running' })

      return
    }
    const stream = { runtime, pending: [] as string[] }

    this.streams.set(s, stream)
    runtime.addEventListener('open', () => {
      if (this.streams.get(s) !== stream) return
      this.send({ t: 'opened', s })
      for (const data of stream.pending.splice(0)) runtime.send(data)
    })
    runtime.addEventListener('message', (event) => {
      if (this.streams.get(s) !== stream) return
      if (typeof event.data === 'string') this.send({ t: 'data', s, d: event.data })
    })
    runtime.addEventListener('close', () => {
      if (this.streams.get(s) !== stream) return
      this.streams.delete(s)
      this.send({ t: 'close', s })
    })
    runtime.addEventListener('error', () => {
      runtime.close()
    })
  }
}
