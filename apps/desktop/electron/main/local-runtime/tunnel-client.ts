import { InstanceStreams } from './instance-streams.ts'
import { reportMetrics } from './metrics-report.ts'
import { parseFrame } from './tunnel-protocol.ts'
import { connectLocalStream } from './tunnel-streams.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { BackendFrame, LocalRuntimeTunnelStatus } from './tunnel-protocol.ts'
import type { DeviceMetrics } from '../../../src/api/device-types.ts'

export type TunnelPurpose = 'transport' | 'control'
/** What a backend stream may ask this computer for: an agent, one of its local tools, or its agent inventory. */
export type StreamPurpose =
  | TunnelPurpose
  | 'exec'
  | 'file'
  | 'attachments'
  | 'terminal'
  | 'cua'
  | 'browser'
  | 'vnc'
  | 'instances'

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
  connectRuntime: (
    purpose: TunnelPurpose,
    provider: LocalAgentProvider,
    instanceId?: string,
  ) => SocketLike | null
  instances?: (request: unknown) => Promise<unknown>
  connectFile?: (instanceId?: string) => SocketLike | null
  connectAttachments?: (instanceId?: string) => SocketLike | null
  connectTerminal?: () => SocketLike
  connectExec?: () => SocketLike
  /** Computer Use, only where the Codex App can provide it. */
  connectCua?: () => SocketLike
  connectBrowser?: () => SocketLike
  connectVnc?: () => SocketLike
  activity?: {
    open(id: string, purpose: string): void
    data(id: string, raw: string, incoming: boolean): void
    close(id: string): void
    clear(): void
  }
  sampleMetrics?: () => Promise<DeviceMetrics | null>
  status: () => LocalRuntimeTunnelStatus
  /** `connected` is exactly whether Nuphos holds this computer's tunnel right now. */
  onChange?: (connected: boolean, superseded: boolean) => void
  /** The backend revoked this computer's credential; the tunnel stays down. */
  onRevoked?: () => void
}

const OPEN = 1
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]

/** The backend pings every 5s; silence this long means the socket is dead. */
export const TUNNEL_IDLE_TIMEOUT_MS = 12_000
const CLOSE_SUPERSEDED = 4000
const CLOSE_REVOKED = 4003

export function tunnelReconnectDelayMs(attempt: number): number {
  return (
    RECONNECT_BACKOFF_MS[Math.min(Math.max(attempt, 0), RECONNECT_BACKOFF_MS.length - 1)] ?? 10_000
  )
}

/** One reconnecting backend tunnel; agent runtime listeners stay on loopback. */
export class RuntimeTunnelClient {
  private readonly instanceStreams: InstanceStreams
  private socket: SocketLike | undefined
  private readonly streams = new Map<string, { runtime: SocketLike; pending: string[] }>()
  private stopMetrics: (() => void) | undefined
  private running = false
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private readonly deps: TunnelClientDeps

  constructor(deps: TunnelClientDeps) {
    this.deps = deps
    this.instanceStreams = new InstanceStreams(deps.instances, (frame) => this.send(frame))
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
      status: {
        ...this.deps.status(),
        agentInstances: Boolean(this.deps.instances),
        localMetrics: Boolean(this.deps.sampleMetrics),
        localExec: Boolean(this.deps.connectExec),
        localTerminal: Boolean(this.deps.connectTerminal),
        localCua: Boolean(this.deps.connectCua),
        localBrowser: Boolean(this.deps.connectBrowser),
        localAttachments: Boolean(this.deps.connectAttachments),
      },
    })
  }

  private drop(): void {
    this.stopMetrics?.()
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.idleTimer)
    for (const { runtime } of this.streams.values()) runtime.close()
    this.streams.clear()
    this.instanceStreams.clear()
    this.deps.activity?.clear()
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
      // Reported from the start, so a viewer's first look is already live.
      this.stopMetrics = reportMetrics(this.deps.sampleMetrics, (metrics) =>
        this.send({ t: 'metrics', metrics }),
      )
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
      if (event.code === CLOSE_REVOKED) {
        this.running = false
        this.deps.onRevoked?.()
      } else if (superseded) this.running = false
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
        this.open(frame.s, frame.purpose, frame.provider ?? 'claude-code', frame.instanceId)

        return
      case 'data': {
        if (this.instanceStreams.data(frame.s, frame.d)) return
        const stream = this.streams.get(frame.s)

        if (stream) this.deps.activity?.data(frame.s, frame.d, true)
        if (stream?.runtime.readyState === OPEN) stream.runtime.send(frame.d)
        else stream?.pending.push(frame.d)

        return
      }
      case 'close':
        this.instanceStreams.close(frame.s)
        this.deps.activity?.close(frame.s)
        this.streams.get(frame.s)?.runtime.close()
        this.streams.delete(frame.s)
    }
  }

  private open(
    s: string,
    purpose: StreamPurpose,
    provider: LocalAgentProvider,
    instanceId?: string,
  ): void {
    if (this.streams.has(s) || this.instanceStreams.has(s)) return
    if (purpose === 'instances') {
      this.instanceStreams.open(s)

      return
    }
    const runtime =
      purpose === 'transport' || purpose === 'control'
        ? this.deps.connectRuntime(purpose, provider, instanceId)
        : connectLocalStream(this.deps, purpose, instanceId)

    if (!runtime) {
      this.send({ t: 'close', s, reason: 'The local runtime is not running' })

      return
    }
    const stream = { runtime, pending: [] as string[] }

    this.streams.set(s, stream)
    this.deps.activity?.open(s, purpose)
    runtime.addEventListener('open', () => {
      if (this.streams.get(s) !== stream) return
      this.send({ t: 'opened', s })
      for (const data of stream.pending.splice(0)) runtime.send(data)
    })
    runtime.addEventListener('message', (event) => {
      if (this.streams.get(s) !== stream) return
      if (typeof event.data === 'string') {
        this.deps.activity?.data(s, event.data, false)
        this.send({ t: 'data', s, d: event.data })
      }
    })
    runtime.addEventListener('close', () => {
      if (this.streams.get(s) !== stream) return
      this.streams.delete(s)
      this.deps.activity?.close(s)
      this.send({ t: 'close', s })
    })
  }
}
