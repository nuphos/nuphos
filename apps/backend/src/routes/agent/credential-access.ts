import { getAgentCredentialOptions } from './credential-options'

import type { AgentCredentialOptions } from './types'
import type { AgentCredentialAccess } from '@/lib/agent/db'

export function allCredentialAccessFromOptions(
  options: AgentCredentialOptions,
  userId: string,
  selectAll = false,
): AgentCredentialAccess {
  return {
    awsRoleIds: options.awsRoles.map((role) => role.roleId),
    gcpServiceAccountIds: options.gcpServiceAccounts.map((account) => account.serviceAccountId),
    linodeAccountIds: options.linodeAccounts.map((account) => account.accountId),
    hetznerAccountIds: options.hetznerAccounts.map((account) => account.accountId),
    tencentAccountIds: options.tencentAccounts.map((account) => account.accountId),
    aliyunAccountIds: options.aliyunAccounts.map((account) => account.accountId),
    volcengineAccountIds: options.volcengineAccounts.map((account) => account.accountId),
    azureAccountIds: options.azureAccounts.map((account) => account.accountId),
    huaweiAccountIds: options.huaweiAccounts.map((account) => account.accountId),
    onpremClusterIds: options.onpremClusters.map((cluster) => cluster.clusterId),
    betterStackIntegrationIds: options.betterStackIntegrations.map(
      (integration) => integration.integrationId,
    ),
    uptimeKumaInstanceIds: options.uptimeKumaInstances.map((instance) => instance.instanceId),
    linearWorkspaceIds: options.linearWorkspaces.map((workspace) => workspace.workspaceId),
    jiraSiteIds: options.jiraSites.map((site) => site.siteId),
    asanaAccountIds: options.asanaAccounts.map((account) => account.accountId),
    sentryAccountIds: options.sentryAccounts.map((account) => account.accountId),
    posthogIntegrationIds: options.posthogIntegrations.map((entry) => entry.integrationId),
    tailscaleClientIds: options.tailscaleClients.map((client) => client.clientId),
    zeaburIds: options.zeaburProviders.map((provider) => provider.zeaburId),
    vantaIntegrationIds: options.vantaIntegrations.map((integration) => integration.integrationId),
    secureframeIntegrationIds: options.secureframeIntegrations.map(
      (integration) => integration.integrationId,
    ),
    // Explicit all-credential channel defaults include Resend; other surfaces
    // retain their existing opt-in default.
    resendIntegrationIds: selectAll
      ? options.resendIntegrations.map((entry) => entry.integrationId)
      : [],
    deviceIds: options.devices.map((device) => device.deviceId),
    ...(selectAll
      ? {
          githubInstallationIds: options.githubInstallations.map((entry) => entry.installationId),
          gitlabBindingIds: options.gitlabBindings.map((entry) => entry.bindingId),
          grafanaInstanceIds: options.grafanaInstances.map((entry) => entry.instanceId),
          sonarqubeIntegrationIds: options.sonarqubeIntegrations.map(
            (entry) => entry.integrationId,
          ),
          notionIntegrationIds: options.notionIntegrations.map((entry) => entry.integrationId),
          upstashAccountIds: options.upstashAccounts.map((entry) => entry.accountId),
          cloudflareAccountIds: options.cloudflareAccounts.map((entry) => entry.accountId),
        }
      : {}),
    updatedAt: new Date(),
    updatedBy: userId,
  }
}

/**
 * The principal's full allow-listed bindings as they stand right now, for a
 * headless Trigger run: the same all-credential scope a channel session gets. Recomputing them every run is what makes a revoked
 * connector take effect immediately.
 *
 * This is what a Trigger bound to `credentialMode: 'all'` runs with. A
 * Trigger the user narrowed is intersected with its stored selection instead
 * (see trigger-credential-access.ts), so it can only shrink from there.
 */
export async function resolveTriggerCredentialAccess(
  teamId: string | undefined,
  userId: string,
): Promise<AgentCredentialAccess> {
  const options = await getAgentCredentialOptions(teamId, userId)

  return allCredentialAccessFromOptions(options, userId, true)
}

export function hasCredentialOptions(options: AgentCredentialOptions): boolean {
  return (
    options.awsRoles.length +
      options.gcpServiceAccounts.length +
      options.linodeAccounts.length +
      options.hetznerAccounts.length +
      options.tencentAccounts.length +
      options.aliyunAccounts.length +
      options.volcengineAccounts.length +
      options.azureAccounts.length +
      options.huaweiAccounts.length +
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
      options.cloudflareAccounts.length +
      options.devices.length >
    0
  )
}

export function isEmptyCredentialAccess(access: AgentCredentialAccess | undefined): boolean {
  if (!access) return true

  return (
    (access.awsRoleIds?.length ?? 0) +
      (access.gcpServiceAccountIds?.length ?? 0) +
      (access.linodeAccountIds?.length ?? 0) +
      (access.hetznerAccountIds?.length ?? 0) +
      (access.tencentAccountIds?.length ?? 0) +
      (access.aliyunAccountIds?.length ?? 0) +
      (access.volcengineAccountIds?.length ?? 0) +
      (access.azureAccountIds?.length ?? 0) +
      (access.huaweiAccountIds?.length ?? 0) +
      (access.onpremClusterIds?.length ?? 0) +
      (access.betterStackIntegrationIds?.length ?? 0) +
      (access.uptimeKumaInstanceIds?.length ?? 0) +
      (access.linearWorkspaceIds?.length ?? 0) +
      (access.jiraSiteIds?.length ?? 0) +
      (access.asanaAccountIds?.length ?? 0) +
      (access.sentryAccountIds?.length ?? 0) +
      (access.posthogIntegrationIds?.length ?? 0) +
      (access.tailscaleClientIds?.length ?? 0) +
      (access.zeaburIds?.length ?? 0) +
      (access.vantaIntegrationIds?.length ?? 0) +
      (access.secureframeIntegrationIds?.length ?? 0) +
      (access.resendIntegrationIds?.length ?? 0) +
      (access.githubInstallationIds?.length ?? 0) +
      (access.gitlabBindingIds?.length ?? 0) +
      (access.grafanaInstanceIds?.length ?? 0) +
      (access.sonarqubeIntegrationIds?.length ?? 0) +
      (access.notionIntegrationIds?.length ?? 0) +
      (access.upstashAccountIds?.length ?? 0) +
      (access.cloudflareAccountIds?.length ?? 0) +
      (access.deviceIds?.length ?? 0) ===
    0
  )
}

export function credentialAccessResponse(access: AgentCredentialAccess) {
  return {
    ...access,
    onpremClusterIds: access.onpremClusterIds ?? [],
    linearWorkspaceIds: access.linearWorkspaceIds ?? [],
    resendIntegrationIds: access.resendIntegrationIds ?? [],
    posthogIntegrationIds: access.posthogIntegrationIds ?? [],
    deviceIds: access.deviceIds ?? [],
    updatedAt: access.updatedAt.toISOString(),
  }
}
