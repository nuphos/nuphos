import type { BoxMetrics } from '../metrics-schema'
import type { TunnelBus } from './bus'
import type { LocalRuntimePresenceStore } from './presence'
import type { BackendFrame, LocalRuntimeStatus } from './protocol'
import type { RequestOrigin } from '@/lib/request-origin'

export type TunnelConnection = {
  send(frame: BackendFrame): void
  close(code: number, reason: string): void
}

export type TunnelHolderDeps = {
  bus: TunnelBus
  presence: LocalRuntimePresenceStore
  isMember: (userId: string, teamId: string) => Promise<boolean>
  heartbeatMs?: number
  idleTimeoutMs?: number
  /** How long the holder's own bus pings may go unanswered before its subscription counts as dead. */
  channelTimeoutMs?: number
  /** Keeps the agents a report shows signed in listed while the computer is offline. */
  recordAgents?: (
    userId: string,
    deviceId: string,
    status: LocalRuntimeStatus,
    from?: RequestOrigin,
  ) => Promise<void>
  /** Told when the tunnel opens or closes, and of every usage report; neither may throw. */
  connectionChanged?: (userId: string, deviceId: string) => void
  recordMetrics?: (userId: string, deviceId: string, metrics: BoxMetrics) => void
}

export type RuntimeTunnel = {
  receive(raw: string): void
  /** The socket closed, with the WebSocket close code and reason when known. */
  closed(code?: number, reason?: string): void
}
