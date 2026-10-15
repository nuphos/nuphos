import type { LocalAgentProvider } from './agent-cli.ts'
import type { LocalModelCatalog } from './model-probe.ts'
import type { StreamPurpose } from './tunnel-client.ts'

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
  | { t: 'metrics'; leaseMs: number }

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
        cli: { installed: boolean; loggedIn: boolean | null }
        usage?: unknown
        usageAt?: string
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
  desktops?: { sessionId: string; display: number }[]
}
