import type { LocalAgentProvider } from './agent-cli.ts'
import type { AppUpdateStatus } from './app-update-request.ts'
import type { LocalModelCatalog } from './model-probe.ts'

export type TunnelPurpose = 'transport' | 'control'
/** What a backend stream may ask this computer for: an agent, one of its local tools, or its agent inventory. */
export type StreamPurpose =
  | TunnelPurpose
  | 'exec'
  | 'upload'
  | 'download'
  | 'file'
  | 'attachments'
  | 'terminal'
  | 'cua'
  | 'browser'
  | 'browserView'
  | 'vnc'
  | 'instances'

export type BackendFrame =
  | {
      t: 'open'
      s: string
      purpose: StreamPurpose
      provider?: LocalAgentProvider
      instanceId?: string
    }
  | { t: 'data'; s: string; d: string }
  | { t: 'close'; s: string; reason?: string }
  | { t: 'ping' }

/** Why this computer gave up its last tunnel; the backend never sees that close itself. */
export type TunnelDrop = {
  reason: 'idle' | 'closed' | 'reconnect'
  code: number | undefined
  /** Time since the last frame from the backend. */
  silentMs: number
}

export function parseFrame(raw: unknown): BackendFrame | null {
  if (typeof raw !== 'string') return null
  try {
    const frame = JSON.parse(raw) as BackendFrame

    return typeof frame === 'object' && typeof frame.t === 'string' ? frame : null
  } catch {
    return null
  }
}

/** Lists only the agents running right now; the owner sees exactly these. */
export type LocalRuntimeTunnelStatus = {
  agents: Partial<
    Record<
      LocalAgentProvider,
      {
        cli: {
          installed: boolean
          loggedIn: boolean | null
          apiKey?: true
          /** An added agent's CLI being installed, or why that failed. */
          installing?: true
          installError?: string
          probeError?: string
        }
        usage?: unknown
        usageAt?: string
        /** Which account's quota it spends, hashed on that computer. */
        accountKey?: string
        version?: string
        models?: LocalModelCatalog
      }
    >
  >
  instances?: ({
    instanceId: string
    provider: LocalAgentProvider
    label: string
    /** Pending until its first sign-in; the backend lists only ready agents. */
    state?: 'pending' | 'ready'
  } & Partial<NonNullable<LocalRuntimeTunnelStatus['agents']['codex']>>)[]
  backendUrl?: string
  cliVersion?: string
  /** This Nuphos Desktop and the update it found; its owner restarts into it with `method: 'update'`. */
  app?: AppUpdateStatus
  /** Whether this computer installs updates by itself when idle; the card sets it with `method: 'autoInstall'`. */
  autoInstall?: boolean
  desktops?: { sessionId: string; display: number }[]
  /** Opens a conversation's desktop on request (`method: 'desktop'`). */
  desktopOpen?: boolean
}
