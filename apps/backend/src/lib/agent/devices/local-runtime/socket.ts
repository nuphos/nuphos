import { randomUUID } from 'node:crypto'

import { parseLocalRuntimeUrl, purposeFromProtocols } from './address'
import { tunnelBus } from './bus'
import { runtimePresenceStore } from './presence'
import { holderChannel, parseJson, streamChannel } from './protocol'

import type { TunnelBus } from './bus'
import type { LocalRuntimePresenceStore } from './presence'
import type { HolderMessage, LocalAgentProvider, StreamMessage, TunnelPurpose } from './protocol'

type SocketEvent = { data?: unknown; code?: number; reason?: string }
type Listener = (event: SocketEvent) => void

export type DeviceRuntimeSocketDeps = {
  bus: TunnelBus
  presence: LocalRuntimePresenceStore
  livenessMs?: number
}

export type DeviceStreamTarget = {
  userId: string
  deviceId: string
  teamId: string
  purpose: TunnelPurpose
  provider?: LocalAgentProvider
}

const CONNECTING = 0
const OPEN = 1
const CLOSED = 3
const DEFAULT_LIVENESS_MS = 10_000
const OFFLINE_REASON = 'The computer running this agent is offline'

/**
 * A WebSocket-shaped ACP stream to a computer's local runtime, carried over the
 * tunnel that computer holds on whichever replica it reached.
 */
export class DeviceRuntimeSocket {
  readyState = CONNECTING
  readonly protocol = 'acp.v1'
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly streamId = randomUUID()
  private unsubscribe: (() => void) | undefined
  private liveness: ReturnType<typeof setInterval> | undefined
  private conn: string | undefined

  constructor(
    private readonly target: DeviceStreamTarget,
    private readonly deps: DeviceRuntimeSocketDeps,
  ) {}

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set()

    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    if (this.readyState !== OPEN) throw new Error('Local runtime stream is not open')
    void this.toHolder({ t: 'data', s: this.streamId, d: data })
  }

  close(): void {
    if (this.readyState === CLOSED) return
    void this.toHolder({ t: 'close', s: this.streamId })
    this.finish(1000, '')
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  private toHolder(message: HolderMessage): Promise<void> {
    return this.deps.bus
      .publish(holderChannel(this.target.userId, this.target.deviceId), JSON.stringify(message))
      .catch(() => {})
  }

  private finish(code: number, reason: string): void {
    if (this.readyState === CLOSED) return
    this.readyState = CLOSED
    clearInterval(this.liveness)
    this.unsubscribe?.()
    this.emit('close', { code, reason })
  }

  private onStream = (raw: string) => {
    const message = parseJson<StreamMessage>(raw)

    if (!message || this.readyState === CLOSED) return
    if (message.t === 'opened') {
      this.readyState = OPEN
      this.emit('open', {})
    } else if (message.t === 'data') this.emit('message', { data: message.d })
    else if (message.t === 'close') this.finish(message.code ?? 1006, message.reason ?? '')
  }

  async connect(): Promise<void> {
    const { userId, deviceId, teamId, purpose, provider } = this.target

    try {
      const presence = await this.deps.presence.get(userId, deviceId)

      if (
        !presence ||
        (purpose === 'exec' && presence.status?.localExec !== true) ||
        (purpose === 'terminal' && presence.status?.localTerminal !== true)
      ) {
        throw new Error(OFFLINE_REASON)
      }
      this.conn = presence.conn
      this.unsubscribe = await this.deps.bus.subscribe(streamChannel(this.streamId), this.onStream)
      if (this.readyState === CLOSED) {
        this.unsubscribe()

        return
      }
      await this.deps.bus.publish(
        holderChannel(userId, deviceId),
        JSON.stringify({
          t: 'open',
          s: this.streamId,
          conn: presence.conn,
          teamId,
          purpose,
          provider,
        } satisfies HolderMessage),
      )
      if (this.readyState === CLOSED) return
      this.liveness = setInterval(
        () => void this.checkLiveness(),
        this.deps.livenessMs ?? DEFAULT_LIVENESS_MS,
      )
    } catch (error) {
      this.finish(1006, error instanceof Error ? error.message : OFFLINE_REASON)
    }
  }

  private async checkLiveness(): Promise<void> {
    const presence = await this.deps.presence
      .get(this.target.userId, this.target.deviceId)
      .catch(() => null)

    if (presence?.conn === this.conn) return
    void this.toHolder({ t: 'close', s: this.streamId })
    this.finish(1006, OFFLINE_REASON)
  }
}

export function openLocalRuntimeSocket(
  url: string,
  protocols: string[],
  deps: DeviceRuntimeSocketDeps = { bus: tunnelBus(), presence: runtimePresenceStore() },
): DeviceRuntimeSocket {
  const target = parseLocalRuntimeUrl(url)

  if (!target) throw new Error('Invalid local runtime address')

  const socket = new DeviceRuntimeSocket(
    { ...target, purpose: purposeFromProtocols(protocols) },
    deps,
  )

  void socket.connect()

  return socket
}
