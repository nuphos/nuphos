import type { BindingAccessProvider } from '../../components/BindingAccess'
import type { ConnectorInfoProvider } from '../../lib/appRoutes'

// Maps a connector-info provider to its BindingAccess provider key, for the
// subset whose member list an admin can edit. Everything else renders no editor.
export const ACCESS_EDITABLE_PROVIDERS: Partial<
  Record<ConnectorInfoProvider, BindingAccessProvider>
> = {
  upstash: 'upstash',
  posthog: 'posthog',
  trello: 'trello',
  tencent: 'tencent',
  aliyun: 'aliyun',
  volcengine: 'volcengine',
  huawei: 'huawei',
  betterstack: 'betterstack',
  plaud: 'plaud',
  cloudflare: 'cloudflare',
  github: 'github',
  gitlab: 'gitlab',
  grafana: 'grafana',
  linode: 'linode',
  hetzner: 'hetzner',
  tailscale: 'tailscale',
  linear: 'linear',
  jira: 'jira',
  asana: 'asana',
  sentry: 'sentry',
  notion: 'notion',
  resend: 'resend',
  sonarqube: 'sonarqube',
  vanta: 'vanta',
  secureframe: 'secureframe',
  'uptime-kuma': 'uptime-kuma',
  'onprem-k8s': 'onprem',
}

const MANAGED_PROVIDERS = new Set<ConnectorInfoProvider>([
  'sonarqube',
  'tailscale',
  'slack',
  'lark',
])

/** Whether the connector renders management UI below its connection details. */
export function hasConnectorManagement(provider: ConnectorInfoProvider): boolean {
  return MANAGED_PROVIDERS.has(provider) || provider in ACCESS_EDITABLE_PROVIDERS
}
