import { t } from '../../../i18n/index.ts'

import { parseDecisionQuestions } from './decisionFormModel.ts'

import type { DecisionQuestion } from './decisionFormModel.ts'
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
  trello: 'trelloIntegrationIds',
  cloudflare: 'cloudflareAccountIds',
  instabox: 'instaboxAccountIds',
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

/**
 * An integration `request_user_decision` and its Connect card: `providers` asks
 * for any access of a kind, `credentials` for the member's own credential only
 * (`personal`). One that names both is no card: what answers it is unclear.
 */
export function parseConnectRequest(
  value: unknown,
): { providers: ConnectProvider[]; reason: string; personal: boolean } | null {
  if (!value || typeof value !== 'object') return null
  const { category, providers, credentials, question } = value as {
    category?: unknown
    providers?: unknown
    credentials?: unknown
    question?: unknown
  }

  if (category !== 'integration') return null
  const reason = typeof question === 'string' ? question : ''

  if (credentials !== undefined) {
    if (providers !== undefined || !Array.isArray(credentials)) return null
    const own = [
      ...new Set(
        credentials.flatMap((ref: { provider?: unknown; id?: unknown }) =>
          ref?.provider === 'personal' && (ref.id === 'github' || ref.id === 'linear')
            ? [ref.id as ConnectProvider]
            : [],
        ),
      ),
    ]

    return own.length > 0 ? { providers: own, reason, personal: true } : null
  }
  if (!Array.isArray(providers)) return null
  const known = [
    ...new Set(
      providers.filter(
        (p): p is ConnectProvider => typeof p === 'string' && p in CONNECT_SELECTION_KEY,
      ),
    ),
  ]

  return known.length > 0 ? { providers: known, reason, personal: false } : null
}

/** A credential `request_user_decision` that names a `secretName`: its secure input card. */
export function parseSecretRequest(value: unknown): { name: string; reason: string } | null {
  if (!value || typeof value !== 'object') return null
  const { category, secretName, question } = value as {
    category?: unknown
    secretName?: unknown
    question?: unknown
  }

  if (category !== 'credential' || typeof secretName !== 'string') return null
  if (!/^[A-Za-z]\w{0,63}$/.test(secretName)) return null

  return { name: secretName, reason: typeof question === 'string' ? question : '' }
}

/** The reply a secret card sends once its value is saved, before the file's path. */
export function secretSavedReply(name: string): string {
  return `🔒 ${name} saved to `
}

/** Any other `request_user_decision`: its question card, with the options as replies. */
export function parseChoiceRequest(value: unknown): {
  category: string
  question: string
  body?: string
  options: string[]
  multiSelect?: boolean
  questions?: DecisionQuestion[]
} | null {
  if (
    !value ||
    typeof value !== 'object' ||
    parseConnectRequest(value) ||
    parseSecretRequest(value)
  )
    return null
  const { category, question, body, options, multiSelect, questions } = value as {
    category?: unknown
    question?: unknown
    body?: unknown
    options?: unknown
    multiSelect?: unknown
    questions?: unknown
  }
  const parsedQuestions = parseDecisionQuestions(questions)

  if (typeof question !== 'string' || !question.trim()) return null

  return {
    category: typeof category === 'string' ? category : '',
    question: question.trim(),
    ...(typeof body === 'string' && body.trim() ? { body: body.trim() } : {}),
    options: Array.isArray(options)
      ? options.filter((o): o is string => typeof o === 'string' && o.trim() !== '')
      : [],
    ...(multiSelect === true ? { multiSelect: true } : {}),
    ...(parsedQuestions ? { questions: parsedQuestions } : {}),
  }
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

/**
 * Why a member cannot connect this provider: every route that first binds a
 * team's connector takes `requireTeamRole('ADMINISTRATOR')`. Only GitHub's flow
 * is an App install; the rest, GitLab included, are OAuth connects.
 */
export function connectBlock(
  provider: ConnectProvider,
  isTeamAdmin: boolean,
): { label: string } | undefined {
  if (isTeamAdmin) return undefined

  // A member's own credential is asked for by `credentials`, which draws another row.
  const label =
    provider === 'github'
      ? t('Ask a team admin to install it')
      : t('Ask a team admin to connect it')

  return { label }
}

/**
 * A row for the member's own credential: selected only by personalCredentialIds,
 * never by a team binding or identity; `available` once they have connected it.
 */
export function personalConnectStatus(
  provider: 'github' | 'linear',
  selected: AgentCredentialSelection,
  own: readonly { provider: string }[],
): ConnectRowStatus {
  if ((selected.personalCredentialIds ?? []).includes(provider)) return 'connected'

  return own.some((credential) => credential.provider === provider) ? 'available' : 'idle'
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

/** The open request a decision's tool result names as `requestId`, also inside a text result. */
export function decisionRequestId(output: unknown): string | undefined {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? null)

  return /\\?"requestId\\?"\s*:\s*\\?"([^"\\]+)/.exec(text)?.[1]
}
