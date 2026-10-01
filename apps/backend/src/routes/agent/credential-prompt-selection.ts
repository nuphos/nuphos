import type { AgentCredentialOptions } from './types'
import type { AgentCredentialAccess } from '@/lib/agent/db'

export type AgentCredentialAccessSelection = Pick<
  AgentCredentialAccess,
  | 'awsRoleIds'
  | 'gcpServiceAccountIds'
  | 'linodeAccountIds'
  | 'hetznerAccountIds'
  | 'tencentAccountIds'
  | 'aliyunAccountIds'
  | 'volcengineAccountIds'
  | 'azureAccountIds'
  | 'huaweiAccountIds'
  | 'onpremClusterIds'
  | 'betterStackIntegrationIds'
  | 'uptimeKumaInstanceIds'
  | 'linearWorkspaceIds'
  | 'jiraSiteIds'
  | 'asanaAccountIds'
  | 'sentryAccountIds'
  | 'tailscaleClientIds'
  | 'zeaburIds'
  | 'vantaIntegrationIds'
  | 'secureframeIntegrationIds'
  | 'resendIntegrationIds'
  | 'posthogIntegrationIds'
  | 'githubInstallationIds'
  | 'gitlabBindingIds'
  | 'grafanaInstanceIds'
  | 'sonarqubeIntegrationIds'
  | 'notionIntegrationIds'
  | 'upstashAccountIds'
  | 'cloudflareAccountIds'
  | 'deviceIds'
>

export type SelectedAgentCredentials = ReturnType<typeof selectAgentCredentials>

function pick<T>(
  items: T[] | undefined,
  ids: string[] | undefined,
  idOf: (item: T) => string,
): T[] {
  const selected = new Set(ids ?? [])

  return (items ?? []).filter((item) => selected.has(idOf(item)))
}

export function selectAgentCredentials(
  rawAccess: AgentCredentialAccessSelection | undefined,
  options: AgentCredentialOptions,
) {
  const access: Partial<AgentCredentialAccessSelection> = rawAccess ?? {}

  return {
    awsRoles: pick(options.awsRoles, access.awsRoleIds, (role) => role.roleId),
    gcpServiceAccounts: pick(
      options.gcpServiceAccounts,
      access.gcpServiceAccountIds,
      (account) => account.serviceAccountId,
    ),
    linodeAccounts: pick(
      options.linodeAccounts,
      access.linodeAccountIds,
      (account) => account.accountId,
    ),
    hetznerAccounts: pick(
      options.hetznerAccounts,
      access.hetznerAccountIds,
      (account) => account.accountId,
    ),
    tencentAccounts: pick(
      options.tencentAccounts,
      access.tencentAccountIds,
      (account) => account.accountId,
    ),
    aliyunAccounts: pick(
      options.aliyunAccounts,
      access.aliyunAccountIds,
      (account) => account.accountId,
    ),
    volcengineAccounts: pick(
      options.volcengineAccounts,
      access.volcengineAccountIds,
      (account) => account.accountId,
    ),
    azureAccounts: pick(
      options.azureAccounts,
      access.azureAccountIds,
      (account) => account.accountId,
    ),
    huaweiAccounts: pick(
      options.huaweiAccounts,
      access.huaweiAccountIds,
      (account) => account.accountId,
    ),
    onpremClusters: pick(
      options.onpremClusters,
      access.onpremClusterIds,
      (cluster) => cluster.clusterId,
    ),
    betterStackIntegrations: pick(
      options.betterStackIntegrations,
      access.betterStackIntegrationIds,
      (integration) => integration.integrationId,
    ),
    uptimeKumaInstances: pick(
      options.uptimeKumaInstances,
      access.uptimeKumaInstanceIds,
      (instance) => instance.instanceId,
    ),
    linearWorkspaces: pick(
      options.linearWorkspaces,
      access.linearWorkspaceIds,
      (workspace) => workspace.workspaceId,
    ),
    jiraSites: pick(options.jiraSites, access.jiraSiteIds, (site) => site.siteId),
    asanaAccounts: pick(
      options.asanaAccounts,
      access.asanaAccountIds,
      (account) => account.accountId,
    ),
    sentryAccounts: pick(
      options.sentryAccounts,
      access.sentryAccountIds,
      (account) => account.accountId,
    ),
    tailscaleClients: pick(
      options.tailscaleClients,
      access.tailscaleClientIds,
      (client) => client.clientId,
    ),
    zeaburProviders: pick(
      options.zeaburProviders,
      access.zeaburIds,
      (provider) => provider.zeaburId,
    ),
    vantaIntegrations: pick(
      options.vantaIntegrations,
      access.vantaIntegrationIds,
      (integration) => integration.integrationId,
    ),
    secureframeIntegrations: pick(
      options.secureframeIntegrations,
      access.secureframeIntegrationIds,
      (integration) => integration.integrationId,
    ),
    resendIntegrations: pick(
      options.resendIntegrations,
      access.resendIntegrationIds,
      (integration) => integration.integrationId,
    ),
    posthogIntegrations: pick(
      options.posthogIntegrations,
      access.posthogIntegrationIds,
      (integration) => integration.integrationId,
    ),
    githubInstallations: pick(
      options.githubInstallations,
      access.githubInstallationIds,
      (installation) => installation.installationId,
    ),
    gitlabBindings: pick(
      options.gitlabBindings,
      access.gitlabBindingIds,
      (binding) => binding.bindingId,
    ),
    grafanaInstances: pick(
      options.grafanaInstances,
      access.grafanaInstanceIds,
      (instance) => instance.instanceId,
    ),
    sonarqubeIntegrations: pick(
      options.sonarqubeIntegrations,
      access.sonarqubeIntegrationIds,
      (integration) => integration.integrationId,
    ),
    notionIntegrations: pick(
      options.notionIntegrations,
      access.notionIntegrationIds,
      (integration) => integration.integrationId,
    ),
    upstashAccounts: pick(
      options.upstashAccounts,
      access.upstashAccountIds,
      (account) => account.accountId,
    ),
    cloudflareAccounts: pick(
      options.cloudflareAccounts,
      access.cloudflareAccountIds,
      (account) => account.accountId,
    ),
    devices: pick(options.devices, access.deviceIds, (device) => device.deviceId),
  }
}

export function hasNoSelectedCredentials(selected: SelectedAgentCredentials): boolean {
  return Object.values(selected).every((items) => items.length === 0)
}
