import type { AddIntegrationKey } from '../AddIntegrationModal'
import type { ConnectorInfoProvider } from '../ConnectorInfoView'

export type BindProvider =
  | 'aws'
  | 'gcp'
  | 'cloudflare'
  | 'linode'
  | 'hetzner'
  | 'betterstack'
  | 'uptime-kuma'
  | 'tailscale'
  | 'zeabur'
  | 'vanta'
  | 'secureframe'
  | 'notion'
  | 'upstash'
  | 'resend'
  | 'tencent'
  | 'aliyun'
  | 'volcengine'
  | 'huawei'
  | 'azure'

// Connectors that open their own bind dialog. Everything else in
// `AddIntegrationKey` goes to BindAccountDialog, and `BindProvider` must stay
// exactly that remainder — tsc enforces it at the `setBindProvider` call.
export const BIND_DIALOG_KEYS = [
  'github',
  'gitlab',
  'linear',
  'jira',
  'sentry',
  'posthog',
  'asana',
  'grafana',
  'sonarqube',
  'onprem-k8s',
  'slack',
  'discord',
  'lark',
  'mongodb',
] as const

export type BindDialogKey = (typeof BIND_DIALOG_KEYS)[number]
export const BIND_DIALOG_KEY_SET = new Set<string>(BIND_DIALOG_KEYS)

export function isBindDialogKey(key: AddIntegrationKey): key is BindDialogKey {
  return BIND_DIALOG_KEY_SET.has(key)
}

export type IntegrationPlatformRow = {
  key: string
  provider:
    | BindProvider
    | 'github'
    | 'gitlab'
    | 'linear'
    | 'jira'
    | 'asana'
    | 'sentry'
    | 'posthog'
    | 'grafana'
    | 'sonarqube'
    | 'discord'
    | 'slack'
    | 'lark'
    | 'mongodb'
    | 'onprem-k8s'
  account: string
  principal: string
  status: string
  // Optional: rows for read-only providers with no detail/access view (Vanta,
  // Secureframe) omit this so the row click and "Manage access" menu item are
  // inert rather than wired to a no-op.
  onAction?: () => void
  /** Separate access editor when opening the resource itself is the row action. */
  onManageAccess?: () => void
  onDelete?: () => Promise<void>
}

export type OpenConnectorInfo = (detail: {
  provider: ConnectorInfoProvider
  connectorId: string
  name: string
}) => void

export function awsRoleName(roleArn: string): string {
  return roleArn.split('/').pop() || roleArn
}
