export type DeviceIdentity = {
  deviceId: string
  label: string
  createdAt: string
}

export type DeviceExecOutcome = 'ok' | 'timeout' | 'device_offline' | 'rejected' | 'error'

export type DeviceExecOrigin = 'user' | 'trigger' | 'automation' | 'database-alert'

export type DeviceExecAuditEntry = {
  id: string
  deviceId: string
  actorUserId: string
  conversationOwnerUserId: string
  origin: DeviceExecOrigin
  teamId: string
  sessionId: string
  conversationTitle: string | null
  command: string
  commandRedacted: boolean
  requestedAt: string
  dispatchedAt: string | null
  finishedAt: string
  durationMs: number
  outcome: DeviceExecOutcome
  exitCode: number | null
  reason: string | null
}

export type DeviceExecAuditPage = {
  entries: DeviceExecAuditEntry[]
  nextCursor: string | null
}

export type LocalAgentProvider = 'claude-code' | 'codex'

export type AgentCliStatus =
  | { installed: false }
  | {
      installed: true
      path: string
      version?: string
      loggedIn: boolean | null
      account?: string
      plan?: string
    }

export type LocalAgentState = {
  available: boolean
  online: boolean
  error?: string
  cli: AgentCliStatus | null
}

/** Only for an unpackaged app with no local agent bundle: what `bun run dev` is doing about it. */
export type DevBundleHint =
  { state: 'preparing' } | { state: 'failed'; reason: string } | { state: 'missing' }

export type ClaudeLoginState = {
  state: 'idle' | 'waiting' | 'checking' | 'connected' | 'failed' | 'cancelled'
  url?: string
  error?: string
}

export type LocalRuntimeState = {
  claudeLogin?: ClaudeLoginState
  agents: Record<LocalAgentProvider, LocalAgentState>
  workspace: string | null
  userId: string | null
  deviceId?: string
  devBundle?: DevBundleHint
}

export type LocalRuntimeActivityEntry = {
  id: string
  teamId: string
  sessionId: string
  conversationTitle: string | null
  actorUserId: string
  actorName: string | null
  firstServedAt: string
  lastServedAt: string
  turns: number
}

export type LocalRuntimeActivityPage = {
  entries: LocalRuntimeActivityEntry[]
  nextCursor: string | null
}
