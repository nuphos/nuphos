import type { BoxMetrics } from '../metrics-schema'
import type { TunnelBus } from './bus'
import type { LocalRuntimePresenceStore } from './presence'
import type { BackendFrame, LocalRuntimeStatus } from './protocol'
import type { RequestOrigin } from '@/lib/request-origin'

export type TunnelConnection = {
  send(frame: BackendFrame): void
  close(code: number, reason: string): void
  /** The most bytes ever still waiting to go out when another frame was sent. */
  backlog?(): number
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
  /** Told when the tunnel opens and when it ends, however it ends; it may not throw. */
  connectionChanged?: (userId: string, deviceId: string, online: boolean) => void
  recordMetrics?: (userId: string, deviceId: string, metrics: BoxMetrics) => void
  /** The staged update a Desktop too old to install it by itself waits to restart into. */
  stagedUpdateToRestart?: (status: LocalRuntimeStatus) => string | undefined
  /** How long the computer goes unused before it is restarted into that update. */
  restartIdleMs?: number
}

export type RuntimeTunnel = {
  receive(raw: string): void
  /** The socket closed, with the WebSocket close code and reason when known. */
  closed(code?: number, reason?: string): void
}
