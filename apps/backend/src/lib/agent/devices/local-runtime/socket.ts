import { randomUUID } from 'node:crypto'

import { errorTelemetryProperties, logEvent } from '@/lib/observability'

import { parseLocalRuntimeUrl, purposeFromProtocols } from './address'
import { tunnelBus } from './bus'
import { runtimePresenceStore } from './presence'
import { holderChannel, parseJson, streamChannel } from './protocol'

import type { TunnelBus } from './bus'
import type { LocalRuntimePresenceStore } from './presence'
import type {
  HolderMessage,
  LocalAgentProvider,
  LocalRuntimeStatus,
  StreamMessage,
  TunnelPurpose,
} from './protocol'

type SocketEvent = { data?: unknown; code?: number; reason?: string }
type Listener = (event: SocketEvent) => void

export type DeviceRuntimeSocketDeps = {
  bus: TunnelBus
  presence: LocalRuntimePresenceStore
  livenessMs?: number
}

export type DeviceStreamTarget = {
  /** The transport owner: routes to the tunnel, grants nothing. */
  userId: string
  /** Who this stream acts for, already authorized by the caller. */
  actorId: string
  deviceId: string
  teamId: string
  purpose: TunnelPurpose
  provider?: LocalAgentProvider
  instanceId?: string
}

const CONNECTING = 0
const OPEN = 1
const CLOSED = 3
const DEFAULT_LIVENESS_MS = 10_000
const OFFLINE_REASON = 'The computer running this agent is offline'
const CAPABILITY: Partial<Record<TunnelPurpose, keyof LocalRuntimeStatus>> = {
  attachments: 'localAttachments',
  exec: 'localExec',
  terminal: 'localTerminal',
  cua: 'localCua',
  browser: 'localBrowser',
  instances: 'agentInstances',
}

/** Why a connected computer cannot take this stream; the person still reads "offline". */
function refusal(status: LocalRuntimeStatus | undefined, target: DeviceStreamTarget) {
  const capability = CAPABILITY[target.purpose]

  if (capability && status?.[capability] !== true) return 'capability_missing'
  if (
    target.instanceId !== undefined &&
    !status?.instances?.some(
      (instance) =>
        instance.instanceId === target.instanceId && instance.provider === target.provider,
    )
  ) {
    return 'instance_missing'
  }
}

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

  /** Logs which check found the computer unreachable, since the person only sees "offline". */
  private fail(stage: 'connect' | 'liveness', cause: string, error?: unknown): void {
    const { userId, deviceId, purpose, provider, instanceId } = this.target

    logEvent('warn', 'agent.local_runtime.stream_failed', {
      user_id: userId,
      device_id: deviceId,
      purpose,
      provider,
      instance_id: instanceId,
      stage,
      cause,
      ...(error === undefined ? {} : errorTelemetryProperties(error)),
    })
    this.finish(1006, error instanceof Error ? error.message : OFFLINE_REASON)
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
    const { userId, actorId, deviceId, teamId, purpose, provider, instanceId } = this.target

    try {
      const presence = await this.deps.presence.get(userId, deviceId)
      const cause = presence ? refusal(presence.status, this.target) : 'no_presence'

      if (!presence || cause) {
        this.fail('connect', cause ?? 'no_presence')

        return
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
          actorId,
          purpose,
          provider,
          ...(instanceId ? { instanceId } : {}),
        } satisfies HolderMessage),
      )
      if (this.readyState === CLOSED) return
      this.liveness = setInterval(
        () => void this.checkLiveness(),
        this.deps.livenessMs ?? DEFAULT_LIVENESS_MS,
      )
    } catch (error) {
      this.fail('connect', 'error', error)
    }
  }

  private async checkLiveness(): Promise<void> {
    const presence = await this.deps.presence
      .get(this.target.userId, this.target.deviceId)
      .catch(() => null)

    if (presence?.conn === this.conn || this.readyState === CLOSED) return
    void this.toHolder({ t: 'close', s: this.streamId })
    this.fail('liveness', presence ? 'tunnel_replaced' : 'no_presence')
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
