import type { CredentialSelectorControl } from './credentialSections'

export function countSelectedCredentials(value: CredentialSelectorControl['value']): number {
  return (
    value.awsRoleIds.length +
    value.gcpServiceAccountIds.length +
    value.linodeAccountIds.length +
    value.hetznerAccountIds.length +
    value.tencentAccountIds.length +
    value.aliyunAccountIds.length +
    value.volcengineAccountIds.length +
    value.huaweiAccountIds.length +
    value.azureAccountIds.length +
    value.onpremClusterIds.length +
    value.betterStackIntegrationIds.length +
    value.uptimeKumaInstanceIds.length +
    value.linearWorkspaceIds.length +
    value.jiraSiteIds.length +
    value.asanaAccountIds.length +
    value.sentryAccountIds.length +
    value.posthogIntegrationIds.length +
    value.tailscaleClientIds.length +
    value.zeaburIds.length +
    value.vantaIntegrationIds.length +
    value.secureframeIntegrationIds.length +
    value.resendIntegrationIds.length +
    value.githubInstallationIds.length +
    value.gitlabBindingIds.length +
    value.grafanaInstanceIds.length +
    value.sonarqubeIntegrationIds.length +
    value.notionIntegrationIds.length +
    value.upstashAccountIds.length +
    value.cloudflareAccountIds.length
  )
}

export function countTotalCredentials(options: CredentialSelectorControl['options']): number {
  return (
    options.awsRoles.length +
    options.gcpServiceAccounts.length +
    options.linodeAccounts.length +
    options.hetznerAccounts.length +
    options.tencentAccounts.length +
    options.aliyunAccounts.length +
    options.volcengineAccounts.length +
    options.azureAccounts.length +
    options.onpremClusters.length +
    options.betterStackIntegrations.length +
    options.uptimeKumaInstances.length +
    options.linearWorkspaces.length +
    options.jiraSites.length +
    options.asanaAccounts.length +
    options.sentryAccounts.length +
    options.posthogIntegrations.length +
    options.tailscaleClients.length +
    options.zeaburProviders.length +
    options.vantaIntegrations.length +
    options.secureframeIntegrations.length +
    options.resendIntegrations.length +
    options.githubInstallations.length +
    options.gitlabBindings.length +
    options.grafanaInstances.length +
    options.sonarqubeIntegrations.length +
    options.notionIntegrations.length +
    options.upstashAccounts.length +
    options.cloudflareAccounts.length
  )
}
