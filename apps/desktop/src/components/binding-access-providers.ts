import { api } from '../api'

import type { BindingAccess } from '../types'

export type BindingAccessProvider =
  | 'aws'
  | 'gcp'
  | 'azure'
  | 'upstash'
  | 'posthog'
  | 'tencent'
  | 'aliyun'
  | 'volcengine'
  | 'huawei'
  | 'betterstack'

type ProviderConfig = {
  /** The noun shown to the user for the thing being scoped. */
  resourceLabel: string
  /**
   * Whether the backend gate lets team ADMINISTRATORs through regardless of the
   * allow-list. This is NOT uniform across connectors: tencent/aliyun/volcengine
   * (and upstash) bypass inline in their route/middleware, while aws/gcp/
   * betterstack deny an admin who isn't listed. The UI states whichever is true
   * rather than implying one rule.
   */
  adminBypass: boolean
  load: (teamId: string, id: string, secondaryId?: string) => Promise<BindingAccess>
  save: (
    teamId: string,
    id: string,
    input: Pick<BindingAccess, 'memberAllowList'>,
    secondaryId?: string,
  ) => Promise<BindingAccess>
}

export const PROVIDERS: Record<BindingAccessProvider, ProviderConfig> = {
  aws: {
    resourceLabel: 'role',
    adminBypass: false,
    load: (teamId, id, roleId) => api.atlasGetAwsAccountAccess(teamId, id, roleId),
    save: (teamId, id, input, roleId) => api.atlasUpdateAwsAccountAccess(teamId, id, input, roleId),
  },
  gcp: {
    resourceLabel: 'service account',
    adminBypass: false,
    load: (teamId, id, bindingId) => api.atlasGetGcpProjectAccess(teamId, id, bindingId),
    save: (teamId, id, input, bindingId) =>
      api.atlasUpdateGcpProjectAccess(teamId, id, input, bindingId),
  },
  azure: {
    resourceLabel: 'app',
    // azure-accounts.ts gates the scoped routes with the same inline
    // `teamRole !== 'ADMINISTRATOR' && !canUseAllowList(...)` as the CN trio.
    adminBypass: true,
    load: (teamId, id) => api.atlasGetAzureAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateAzureAccountAccess(teamId, id, input),
  },
  upstash: {
    resourceLabel: 'Upstash account',
    adminBypass: true,
    load: (teamId, id) => api.atlasGetUpstashAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateUpstashAccountAccess(teamId, id, input),
  },
  posthog: {
    resourceLabel: 'PostHog integration',
    adminBypass: false,
    load: (teamId, id) => api.atlasGetPosthogIntegrationAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdatePosthogIntegrationAccess(teamId, id, input),
  },
  tencent: {
    resourceLabel: 'Tencent Cloud binding',
    adminBypass: true,
    load: (teamId, id) => api.atlasGetTencentAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateTencentAccountAccess(teamId, id, input),
  },
  aliyun: {
    resourceLabel: 'Alibaba Cloud binding',
    adminBypass: true,
    load: (teamId, id) => api.atlasGetAliyunAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateAliyunAccountAccess(teamId, id, input),
  },
  volcengine: {
    resourceLabel: 'Volcengine binding',
    adminBypass: true,
    load: (teamId, id) => api.atlasGetVolcengineAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateVolcengineAccountAccess(teamId, id, input),
  },
  huawei: {
    resourceLabel: 'Huawei Cloud binding',
    adminBypass: true,
    load: (teamId, id) => api.atlasGetHuaweiAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateHuaweiAccountAccess(teamId, id, input),
  },
  betterstack: {
    resourceLabel: 'Better Stack integration',
    adminBypass: false,
    load: (teamId, id) => api.atlasGetBetterStackIntegrationAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateBetterStackIntegrationAccess(teamId, id, input),
  },
}
