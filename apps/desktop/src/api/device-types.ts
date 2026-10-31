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
export type LocalAgentProvider = 'claude-code' | 'codex' | 'grok' | 'opencode'

/** The agents this app signs in itself, through their own CLI login; the rest sign in from Nuphos. */
export type CliLoginProvider = 'claude-code' | 'codex'

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
  /** Whether a phone may open this Mac's own screen; absent off a Mac. */
  phoneControl?: boolean
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
/** How far an owner lets teammates use their own computer's Local Agent. */
export type LocalShareLevel = 'off' | 'approve' | 'full'

/** Who a computer is shared with in one team, and how far. */
export type LocalShareInput = { level: LocalShareLevel; everyone: boolean; userIds: string[] }

/** A computer's share in one team, and the most the team's administrators allow. */
export type LocalAgentShareState = { share: LocalShareInput; ceiling: LocalShareLevel }

/** A teammate's conversation waiting for the owner's answer before it runs on their computer. */
/** Where a person's own conversation stands with the owner of a shared computer; null when never asked. */
export type ShareApprovalStatus = 'pending' | 'approved' | 'denied' | null

/** How long approving also trusts the teammate on this computer: their next conversations run unasked. */
export type ShareTrustDuration = '8h' | 'always'

/** A teammate the owner trusts on their computer; `expiresAt` null until taken back. */
export type LocalShareTrust = { actorId: string; expiresAt: string | null }

/** Who was asked to sign an agent in, or reminded to approve; a repeat notifies nobody. */
export type SignInAsk = { askedName: string; notified: boolean }

export type LocalShareApproval = {
  id: string
  deviceId: string
  deviceLabel: string
  sessionId: string
  /** The waiting conversation's title, when it has one. */
  title?: string
  actorId: string
  requestedAt: string
}

/** Who may use a Box besides the team's admins, who always may. */
export type BoxAccess = { everyone: boolean; userIds: string[] }

export type BoxStatus = {
  provider: 'instabox'
  /** Only for those who manage the Box. */
  access?: BoxAccess
  /** Set once the machine exists. */
  sandboxId?: string
  state: BoxState
  /** While an update restarts its host: when it began. Absent from older backends. */
  updateStartedAt?: string
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
  /** For managers: when and from where the host last reported in. */
  lastSeenAt?: string
  lastSeen?: { ip: string; city?: string; country?: string } | null
  box?: BoxStatus
  /** A Box's displays of the viewer's own conversations, besides its own :1. */
  desktops?: { display: number; sessionId: string; title: string }[]
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
  /** A new Box's default size: the smallest of `sizes`. */
  boxVcpus: number | null
  /** The sizes a new Box can have, smallest first; absent from older backends. */
  sizes?: { vcpus: number; memMiB: number }[]
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
