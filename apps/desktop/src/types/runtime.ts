/** Every agent a team runtime can run. This computer's own agent is narrower: `LocalAgentProvider`. */
export const AGENT_PROVIDERS = ['claude-code', 'codex', 'grok', 'antigravity', 'opencode'] as const

export type AgentProvider = (typeof AGENT_PROVIDERS)[number]

/** Each agent's name, and the account its sign-in uses. */
export const AGENT_PROVIDER: Record<AgentProvider, { label: string; account: string }> = {
  'claude-code': { label: 'Claude Code', account: 'Claude' },
  codex: { label: 'Codex', account: 'ChatGPT' },
  grok: { label: 'Grok Build', account: 'xAI' },
  antigravity: { label: 'Antigravity', account: 'Google' },
  opencode: { label: 'OpenCode', account: 'a model provider' },
}

export type RuntimeDefaults = {
  model?: string
  fast?: 'on' | 'off'
  effort?: string
}

export type LocalRuntimeSummary = {
  ownerUserId: string
  deviceId: string
  deviceLabel: string
  /** The owner's own `claude` sign-in; null when their computer cannot tell. */
  signedIn: boolean | null
  /** Provider usage that computer reported; the backend normalizes it. */
  usage?: unknown
  /** When that computer read the usage above. */
  usageAt?: string
}

export type RuntimeInstance = {
  /** Registered but not reachable yet, so nothing can move onto it. */
  notReady?: boolean
  id: string
  provider: AgentProvider
  label: string
  /** The image a managed runtime runs. */
  image?: string
  status: 'active' | 'disabled'
  kind: 'managed' | 'external' | 'development' | 'local'
  /** Self-hosted only: `paired` holds this team's own key; `password` shares the agent's password. */
  connection?: 'paired' | 'password'
  /** Set for `local`: one of the signed-in user's own computers. */
  local?: LocalRuntimeSummary
  deletion?: { state: 'deleting'; error?: string }
  /** This computer's agent, known locally before the team catalog lists it. */
  starting?: boolean
  defaults?: RuntimeDefaults
  createdAt: string
}

export type CreateRuntimeInput = {
  /** Defaults to the agent type's name, made unique in the team. */
  label?: string
  provider: RuntimeInstance['provider']
  defaults?: RuntimeDefaults
}

/** A runtime the operator runs themselves: Nuphos only learns where it is and
 *  the password its container was started with. The backend detects the
 *  provider when it is omitted and names the runtime after its host. */
export type RegisterExternalRuntimeInput = {
  url: string
  password: string
  provider?: RuntimeInstance['provider']
}

/** Best-effort agent detection for a runtime the operator has not registered
 *  yet, from just the address and password the connect form collects.
 *  `provider` is null when the runtime is unreachable or its adapter did not
 *  identify itself. */
export type ExternalRuntimeProviderProbe = { provider: RuntimeInstance['provider'] | null }

/** Exchanges a pairing code from the agent's console for this team's own key.
 *  `replaceRuntimeId` rotates an existing connection to the same agent in place. */
export type PairExternalRuntimeInput = {
  url: string
  code: string
  label?: string
  replaceRuntimeId?: string
}

export type PairedExternalRuntime = {
  id: string
  label?: string
  provider: RuntimeInstance['provider']
  replaced: boolean
}

export type UpdateRuntimeInput = {
  label?: string
  status?: RuntimeInstance['status']
  defaults?: RuntimeDefaults
}

export type RuntimeQuotaWindow = {
  id: string
  label: string
  usedPercent: number
  resetsAt: string | null
}

export type RuntimeQuota = {
  runtimeId: string
  provider: RuntimeInstance['provider']
  fetchedAt: string
  available: boolean
  reason?: string
  plan?: string
  windows: RuntimeQuotaWindow[]
}

export type RuntimeMetricSample = {
  /** ISO time of the 30-second bucket the sample belongs to. */
  at: string
  cpuMillicores: number | null
  memoryBytes: number | null
  /** Conversations attached to the runtime. */
  sessions: number | null
  /** Size and usage of the runtime's home volume (a self-hosted one's reported volumes). */
  diskTotalBytes: number | null
  diskUsedBytes: number | null
}

export type RuntimeMetrics = { samples: RuntimeMetricSample[] }

export type RuntimeQuotaHistoryRange = '1d' | '7d' | '30d'

/** One usage window of one agent over time, the highest use in each bucket. */
export type RuntimeQuotaHistorySeries = {
  runtimeId: string
  windowId: string
  label: string
  points: { at: string; usedPercent: number }[]
}

/** One step of a sign-in that asks before it authorizes (OpenCode). */
export type RuntimeLoginStep =
  | { kind: 'choose'; message: string; options: { value: string; label: string; hint?: string }[] }
  | { kind: 'input'; message: string; placeholder?: string; secret?: boolean }
  | { kind: 'browser'; url: string; instructions?: string; paste?: 'code' | 'address' }

export type RuntimeLoginStatus = {
  attemptId: string
  state: 'starting' | 'awaiting_authorization' | 'connected' | 'failed' | 'cancelled'
  verificationUri?: string
  userCode?: string
  authorizationUrl?: string
  step?: RuntimeLoginStep
  codeSubmitted?: boolean
  error?: string
  expiresAt: string
}

export type RuntimeModelCatalog = {
  models: { id: string; name: string; description?: string }[]
  controls?: {
    modelId: string
    effort: { value: string; name: string }[]
    fast: boolean
    defaultFast?: 'on' | 'off'
    defaultEffort?: string
  }
  message?: string
}
