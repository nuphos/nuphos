import { InstanceStreams } from './instance-streams.ts'
import { reportMetrics } from './metrics-report.ts'
import { parseFrame } from './tunnel-protocol.ts'
import { connectLocalStream } from './tunnel-streams.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { BackendFrame, StreamPurpose, TunnelDrop } from './tunnel-protocol.ts'
import type { SocketLike, TunnelClientDeps } from './tunnel-streams.ts'

export type { SocketEvent, SocketLike } from './tunnel-streams.ts'

const OPEN = 1
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]

/** The backend pings every 5s; silence this long means the socket is dead. */
export const TUNNEL_IDLE_TIMEOUT_MS = 12_000
const CLOSE_SUPERSEDED = 4000
const CLOSE_REVOKED = 4003

/** The socket in use, with the time of the last frame it received; unset until it opens. */
type Live = { socket: SocketLike; lastFrameAt?: number }

/** One reconnecting backend tunnel; agent runtime listeners stay on loopback. */
export class RuntimeTunnelClient {
  private readonly instanceStreams: InstanceStreams
  private live: Live | undefined
  private readonly streams = new Map<string, { runtime: SocketLike; pending: string[] }>()
  private stopMetrics: (() => void) | undefined
  private running = false
  /** Another app on this computer took the tunnel; dial back only once it is gone. */
  private superseded = false
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private dropped: TunnelDrop | undefined // why the last live socket was given up
  private closeReplaced: (() => void) | undefined // the redialed socket, closed once replaced
  private readonly deps: TunnelClientDeps

  constructor(deps: TunnelClientDeps) {
    this.deps = deps
    this.instanceStreams = new InstanceStreams(deps.instances, (frame) => this.send(frame))
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.superseded = false
    this.attempt = 0
    this.connect()
  }

  stop(): void {
    this.running = false
    this.closeReplaced?.()
    this.drop()
    this.deps.onChange?.(false, false)
  }

  /**
   * The computer woke or was unlocked, so the tunnel may have been away with it. A tunnel
   * that is still answering is left alone: replacing it would end every stream on it, and
   * silence is already what says a tunnel is gone. Only the window it is given to prove
   * itself restarts, counted from the wake rather than from before the computer slept. With
   * no socket there is nothing to wait for, so the backoff is skipped and it dials at once.
   */
  reconnectNow(): void {
    if (!this.running) return
    if (this.live) return this.armIdle(this.live)
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
        agentReset: Boolean(this.deps.instances),
        localMetrics: Boolean(this.deps.sampleMetrics),
        localExec: Boolean(this.deps.connectExec),
        localUpload: Boolean(this.deps.connectUpload),
        localDownload: Boolean(this.deps.connectDownload),
        localTerminal: Boolean(this.deps.connectTerminal),
        localCua: Boolean(this.deps.connectCua),
        localBrowser: Boolean(this.deps.connectBrowser),
        localBrowserView: Boolean(this.deps.connectBrowserView),
        localAttachments: Boolean(this.deps.connectAttachments),
        fileImport: Boolean(this.deps.connectFile),
      },
    })
  }

  private drop(reason?: TunnelDrop['reason'], code?: number): void {
    const live = this.live

    // Only a socket that opened counts; a failed dial is not a lost tunnel.
    if (reason && live?.lastFrameAt !== undefined)
      this.dropped = { reason, code, silentMs: Date.now() - live.lastFrameAt }
    this.stopMetrics?.()
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.idleTimer)
    for (const { runtime } of this.streams.values()) runtime.close()
    this.streams.clear()
    this.instanceStreams.clear()
    this.deps.activity?.clear()
    const socket = live?.socket
    const why = this.running ? 'reconnecting' : 'stopped'
    const close = () => {
      if (socket?.terminate) socket.terminate()
      else socket?.close(1000, why)
    }

    this.live = undefined
    // A silent or stale socket stays open while the redial runs. The backend keeps serving
    // through it until the new tunnel speaks, then takes it over; closing it first would end
    // every stream before a tunnel exists to take them (#3366).
    if (!socket || !this.running || reason !== 'idle') return close()
    this.closeReplaced?.()
    const timer = setTimeout(() => this.closeReplaced?.(), TUNNEL_IDLE_TIMEOUT_MS)

    this.closeReplaced = () => {
      clearTimeout(timer)
      this.closeReplaced = undefined
      close()
    }
  }

  private send(frame: object): void {
    if (this.live?.socket.readyState === OPEN) this.live.socket.send(JSON.stringify(frame))
  }

  /** Silence counts from the last thing the open socket received, its opening included. */
  private armIdle(live: Live, lastFrameAt = live.lastFrameAt): void {
    live.lastFrameAt = lastFrameAt
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (this.live !== live) return
      this.drop('idle')
      this.lost()
    }, TUNNEL_IDLE_TIMEOUT_MS)
  }

  /** The redial is armed before the listener runs, so a listener that throws cannot strand the tunnel. */
  private lost(revoked = false): void {
    this.scheduleReconnect()
    try {
      this.deps.onChange?.(false, this.superseded, revoked)
    } catch (error) {
      console.warn('[local-runtime] tunnel state listener threw', error)
    }
  }

  private connect(): void {
    let socket: SocketLike

    try {
      socket = this.deps.connectBackend(this.superseded)
    } catch {
      this.scheduleReconnect()

      return
    }
    const live: Live = { socket }

    this.live = live
    this.armIdle(live)
    socket.addEventListener('open', () => {
      if (this.live !== live) return
      this.attempt = 0
      this.superseded = false
      this.armIdle(live, Date.now())
      this.sendStatus()
      if (this.dropped) this.send({ t: 'dropped', ...this.dropped })
      this.dropped = undefined
      // Reported from the start, so a viewer's first look is already live.
      this.stopMetrics = reportMetrics(this.deps.sampleMetrics, (metrics) =>
        this.send({ t: 'metrics', metrics }),
      )
      this.deps.onChange?.(true, false)
    })
    socket.addEventListener('message', (event) => {
      if (this.live !== live) return
      this.armIdle(live, Date.now())
      const frame = parseFrame(event.data)

      if (frame) this.handle(frame)
    })
    // A failed connection fires `error` and then `close`; only `close` says why, in its code.
    socket.addEventListener('close', (event) => {
      if (this.live !== live) return
      this.drop('closed', event.code)
      // Taken over: redial with reclaim, which the backend refuses while the other app holds it.
      if (event.code === CLOSE_SUPERSEDED) this.superseded = true
      const revoked = event.code === CLOSE_REVOKED

      if (revoked) this.running = false
      this.lost(revoked)
      if (revoked) this.deps.onRevoked?.()
    })
  }

  private scheduleReconnect(): void {
    if (!this.running) return
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.attempt, RECONNECT_BACKOFF_MS.length - 1)]

    this.attempt += 1
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      if (this.running && !this.live) this.connect()
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
