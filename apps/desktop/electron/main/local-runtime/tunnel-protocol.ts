import type { LocalAgentProvider } from './agent-cli.ts'
import type { StreamPurpose } from './tunnel-client.ts'

export type BackendFrame =
  | {
      t: 'open'
      s: string
      purpose: StreamPurpose
      provider?: LocalAgentProvider
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
