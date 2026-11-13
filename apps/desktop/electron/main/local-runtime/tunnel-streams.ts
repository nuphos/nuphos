import type { LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeTunnelStatus, StreamPurpose, TunnelPurpose } from './tunnel-protocol.ts'
import type { DeviceMetrics } from '../../../src/api/device-types.ts'

export type SocketEvent = { data?: unknown; code?: number }
export type SocketLike = {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  terminate?(): void
  addEventListener(type: string, listener: (event: SocketEvent) => void): void
}
export type TunnelClientDeps = {
  /** Opens the backend tunnel as the signed-in user; `reclaim` only takes a free computer. */
  connectBackend: (reclaim: boolean) => SocketLike
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
  connectUpload?: () => SocketLike
  /** Computer Use, only where the Codex App can provide it. */
  connectCua?: () => SocketLike
  connectBrowser?: () => SocketLike
  /** A phone watching one of a conversation's dock browser tabs (`browser-view.ts`). */
  connectBrowserView?: () => SocketLike
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

/** Local tools stay separate from an agent's transport and control connection. */
export function connectLocalStream(
  deps: TunnelClientDeps,
  purpose: Exclude<StreamPurpose, 'transport' | 'control' | 'instances'>,
  instanceId?: string,
) {
  const connectors = {
    terminal: deps.connectTerminal,
    file: deps.connectFile,
    attachments: deps.connectAttachments,
    exec: deps.connectExec,
    upload: deps.connectUpload,
    cua: deps.connectCua,
    browser: deps.connectBrowser,
    browserView: deps.connectBrowserView,
    vnc: deps.connectVnc,
  }

  return connectors[purpose]?.(instanceId)
}
