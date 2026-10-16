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

/** This computer's own agent CLI; team runtimes can run more (`AgentProvider`). */
export type LocalAgentProvider = 'claude-code' | 'codex'

/** One more agent of a provider on a device. `runtimeId` is the catalog's RuntimeInstance.id. */
export type DeviceAgentInstance = {
  instanceId: string
  provider: LocalAgentProvider
  label: string
  runtimeId: string
  /** Exists only once signed in; until then the Box holds it pending. */
  state?: 'pending'
}

export type AgentCliStatus =
  | { installed: false }
  | {
      installed: true
      path: string
      version?: string
      loggedIn: boolean | null
      account?: string
      plan?: string
      /** Lives inside an app bundle, which updates it. */
      bundled?: true
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

export type LocalAgentLoginState = {
  state: 'idle' | 'waiting' | 'checking' | 'connected' | 'failed' | 'cancelled'
  url?: string
  userCode?: string
  error?: string
}

export type SleepPreferences = { mode: 'off' | 'tasks' | 'host'; onlyOnAC: boolean }
export type SleepState = SleepPreferences & {
  supported: boolean
  active: boolean
  reason: 'unsupported' | 'off' | 'battery' | 'signed-out' | 'idle' | 'active'
}

export type LocalRuntimeState = {
  sleepPrevention?: SleepState
  claudeLogin?: LocalAgentLoginState
  codexLogin?: LocalAgentLoginState
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

/** `connecting`: the machine runs but its host has not joined yet. */
export type BoxState = 'creating' | 'connecting' | 'running' | 'paused' | 'error'

/** A Box: a device Nuphos runs in a sandbox for its owner. */
export type BoxStatus = {
  provider: 'instabox'
  /** Set once the machine exists. */
  sandboxId?: string
  state: BoxState
}

/** One of the signed-in user's devices; `box` is set when Nuphos hosts it. */
export type DeviceMetrics = {
  sampledAt: string
  cpuPercent: number
  memory: { used: number; total: number }
  disk: { used: number; total: number }
}

export type DeviceMetricsStatus = 'offline' | 'unsupported' | 'waiting' | 'stale' | 'live'

/** `teamId` is the page's team: Boxes are listed only inside one. */
export type AgentDeviceListOptions = { metrics?: boolean; teamId?: string }

export type AgentDevice = {
  metricsStatus?: DeviceMetricsStatus
  metricsReceivedAt?: string | null
  metrics?: DeviceMetrics | null
  deviceId: string
  label: string
  platform: string
  model?: string
  createdAt?: string
  allowLocalExec?: boolean
  online?: boolean
  /** What the viewer may do: 'use' runs its agents; 'manage' also changes or deletes it. */
  access?: 'use' | 'manage'
  box?: BoxStatus
}

export type AgentDeviceList = {
  devices: AgentDevice[]
  /** False or missing when this backend cannot create Boxes. */
  boxAvailable?: boolean
}

/** The team's Box vCPU limit and use, from the backend. */
export type BoxUsage = {
  /** Null when unlimited. */
  limitVcpus: number | null
  /** Whether the limit comes from the team's own subscription. */
  subscribed: boolean
  usedVcpus: number | null
  boxVcpus: number | null
  /** Every Box of the team with its own size; `running` ones count against the limit. */
  boxes?: { sandboxId: string; vcpus: number; running: boolean }[]
  /** The billing service; null when this deployment has none. */
  billingUrl: string | null
}

/** The team's running Box vCPUs and its limit over a range, as a step series. */
export type BoxUsageHistory = {
  from: string
  to: string
  points: { at: string; usedVcpus: number; limitVcpus: number | null }[]
}

/** The billing service's read-only summary for the Billing section. */
export type BillingSummary = {
  plan: {
    vcpus: number
    status: string
    currentPeriodEnd: string | null
    cancelAt: string | null
    card: { brand: string; last4: string } | null
  } | null
  invoices: {
    number: string | null
    total: number
    currency: string
    status: string | null
    created: string | null
    url: string | null
  }[]
}
