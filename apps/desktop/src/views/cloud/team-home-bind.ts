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
  'plaud',
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
    | 'plaud'
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
  // Optional: rows for read-only providers with no per-connection detail view
  // (Vanta, Secureframe) omit this and open the provider's list instead.
  onAction?: () => void
  /** Set when the connection is bound but cannot work until someone acts, e.g. "Reconnect required". */
  attention?: string
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
