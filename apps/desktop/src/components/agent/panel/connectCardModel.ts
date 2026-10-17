import type { AgentCredentialSelection } from '../../../api'
import type { AddIntegrationKey } from '../../../views/addIntegrationCatalog'

// The connectors an integration `request_user_decision` may list in `providers`,
// each with the field of the conversation's credential selection its bindings land in.
export const CONNECT_SELECTION_KEY = {
  github: 'githubInstallationIds',
  gitlab: 'gitlabBindingIds',
  linear: 'linearWorkspaceIds',
  jira: 'jiraSiteIds',
  asana: 'asanaAccountIds',
  sentry: 'sentryAccountIds',
  posthog: 'posthogIntegrationIds',
  plaud: 'plaudAccountIds',
  grafana: 'grafanaInstanceIds',
  sonarqube: 'sonarqubeIntegrationIds',
  notion: 'notionIntegrationIds',
  upstash: 'upstashAccountIds',
  resend: 'resendIntegrationIds',
  cloudflare: 'cloudflareAccountIds',
  betterstack: 'betterStackIntegrationIds',
  'uptime-kuma': 'uptimeKumaInstanceIds',
  tailscale: 'tailscaleClientIds',
  zeabur: 'zeaburIds',
  vanta: 'vantaIntegrationIds',
  secureframe: 'secureframeIntegrationIds',
  aws: 'awsRoleIds',
  gcp: 'gcpServiceAccountIds',
  azure: 'azureAccountIds',
  linode: 'linodeAccountIds',
  hetzner: 'hetznerAccountIds',
  tencent: 'tencentAccountIds',
  aliyun: 'aliyunAccountIds',
  volcengine: 'volcengineAccountIds',
  huawei: 'huaweiAccountIds',
  'onprem-k8s': 'onpremClusterIds',
} as const satisfies Partial<Record<AddIntegrationKey, keyof AgentCredentialSelection>>

export type ConnectProvider = keyof typeof CONNECT_SELECTION_KEY

// Card-local progress; `connected`, `available` and `choose` come from the live
// selection. `available`: exactly one bound credential, so one click selects it.
// `choose`: several, so the user picks the one they mean in the credential picker.
export type ConnectPhase = 'idle' | 'connecting' | 'cancelled' | 'error'
export type ConnectRowStatus = 'connected' | 'available' | 'choose' | ConnectPhase

/** An integration `request_user_decision` that lists `providers`: its Connect card. */
export function parseConnectRequest(
  value: unknown,
): { providers: ConnectProvider[]; reason: string } | null {
  if (!value || typeof value !== 'object') return null
  const { category, providers, question } = value as {
    category?: unknown
    providers?: unknown
    question?: unknown
  }

  if (category !== 'integration' || !Array.isArray(providers)) return null
  const known = [
    ...new Set(
      providers.filter(
        (p): p is ConnectProvider => typeof p === 'string' && p in CONNECT_SELECTION_KEY,
      ),
    ),
  ]

  return known.length > 0
    ? { providers: known, reason: typeof question === 'string' ? question : '' }
    : null
}

export function connectRowStatus(
  provider: ConnectProvider,
  phase: ConnectPhase,
  selected: AgentCredentialSelection,
  available: AgentCredentialSelection,
): ConnectRowStatus {
  const key = CONNECT_SELECTION_KEY[provider]
  const bound = new Set(available[key])

  if (selected[key].some((id) => bound.has(id))) return 'connected'
  if (phase !== 'idle') return phase
  if (bound.size === 1) return 'available'

  return bound.size > 1 ? 'choose' : 'idle'
}

/** Ids of `provider` present in `after` but not in `before`: what a bind just added. */
export function newConnectIds(
  provider: ConnectProvider,
  before: AgentCredentialSelection,
  after: AgentCredentialSelection,
): string[] {
  const key = CONNECT_SELECTION_KEY[provider]
  const known = new Set(before[key])

  return after[key].filter((id) => !known.has(id))
}

export function withConnectIds(
  selection: AgentCredentialSelection,
  provider: ConnectProvider,
  ids: readonly string[],
): AgentCredentialSelection {
  const key = CONNECT_SELECTION_KEY[provider]

  return { ...selection, [key]: [...new Set([...selection[key], ...ids])] }
}
