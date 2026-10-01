import type { BindingAccessProvider } from '../../components/BindingAccess'
import type { ConnectorInfoProvider } from '../../lib/appRoutes'

// Maps a connector-info provider to its BindingAccess provider key, for the
// subset that has an /access endpoint. Everything else renders no editor.
export const ACCESS_EDITABLE_PROVIDERS: Partial<
  Record<ConnectorInfoProvider, BindingAccessProvider>
> = {
  upstash: 'upstash',
  posthog: 'posthog',
  tencent: 'tencent',
  aliyun: 'aliyun',
  volcengine: 'volcengine',
  huawei: 'huawei',
  betterstack: 'betterstack',
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
