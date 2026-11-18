import type { LocalRuntimeSummary } from './local-runtime-catalog'
import type { OpenAbProvider } from './runtime-provider'

export type RuntimeInstance = {
  /** Registered but not reachable from here yet, so nothing can move onto it. */
  notReady?: true
  id: string
  provider: OpenAbProvider
  label: string
  /** The image a runtime Nuphos hosts runs. */
  image?: string
  status: 'active' | 'disabled'
  /** `managed` is a self-hosted runtime that Nuphos deploys. */
  kind: 'managed' | 'external' | 'development' | 'local'
  /** Self-hosted only: whether this team holds its own pairing or the runtime's shared password. */
  connection?: 'paired' | 'password'
  /** Set for `local`: one of the requesting user's own computers. */
  local?: LocalRuntimeSummary
  deletion?: { state: 'deleting'; error?: string }
  createdAt: string
}
