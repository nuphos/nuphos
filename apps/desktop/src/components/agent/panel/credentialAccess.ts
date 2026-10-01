import { pruneSelectionToAvailable } from '../../../lib/credentialSelection'

import { EMPTY_CREDENTIAL_ACCESS, EMPTY_CREDENTIAL_OPTIONS } from './constants'

import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'

export function normalizeCredentialAccess(
  value: Partial<AgentCredentialSelection> | null | undefined,
): AgentCredentialSelection {
  return {
    awsRoleIds: value?.awsRoleIds ?? [],
    gcpServiceAccountIds: value?.gcpServiceAccountIds ?? [],
    linodeAccountIds: value?.linodeAccountIds ?? [],
    hetznerAccountIds: value?.hetznerAccountIds ?? [],
    tencentAccountIds: value?.tencentAccountIds ?? [],
    aliyunAccountIds: value?.aliyunAccountIds ?? [],
    volcengineAccountIds: value?.volcengineAccountIds ?? [],
    huaweiAccountIds: value?.huaweiAccountIds ?? [],
    azureAccountIds: value?.azureAccountIds ?? [],
    onpremClusterIds: value?.onpremClusterIds ?? [],
    betterStackIntegrationIds: value?.betterStackIntegrationIds ?? [],
    uptimeKumaInstanceIds: value?.uptimeKumaInstanceIds ?? [],
    linearWorkspaceIds: value?.linearWorkspaceIds ?? [],
    jiraSiteIds: value?.jiraSiteIds ?? [],
    asanaAccountIds: value?.asanaAccountIds ?? [],
    sentryAccountIds: value?.sentryAccountIds ?? [],
    posthogIntegrationIds: value?.posthogIntegrationIds ?? [],
    tailscaleClientIds: value?.tailscaleClientIds ?? [],
    zeaburIds: value?.zeaburIds ?? [],
    vantaIntegrationIds: value?.vantaIntegrationIds ?? [],
    secureframeIntegrationIds: value?.secureframeIntegrationIds ?? [],
    resendIntegrationIds: value?.resendIntegrationIds ?? [],
    githubInstallationIds: value?.githubInstallationIds ?? [],
    gitlabBindingIds: value?.gitlabBindingIds ?? [],
    grafanaInstanceIds: value?.grafanaInstanceIds ?? [],
    sonarqubeIntegrationIds: value?.sonarqubeIntegrationIds ?? [],
    notionIntegrationIds: value?.notionIntegrationIds ?? [],
    upstashAccountIds: value?.upstashAccountIds ?? [],
    cloudflareAccountIds: value?.cloudflareAccountIds ?? [],
    deviceIds: value?.deviceIds ?? [],
  }
}

export function normalizeCredentialOptions(
  value: Partial<AgentCredentialOptions> | null | undefined,
): AgentCredentialOptions {
  return {
    awsRoles: value?.awsRoles ?? [],
    gcpServiceAccounts: value?.gcpServiceAccounts ?? [],
    linodeAccounts: value?.linodeAccounts ?? [],
    hetznerAccounts: value?.hetznerAccounts ?? [],
    tencentAccounts: value?.tencentAccounts ?? [],
    aliyunAccounts: value?.aliyunAccounts ?? [],
    volcengineAccounts: value?.volcengineAccounts ?? [],
    huaweiAccounts: value?.huaweiAccounts ?? [],
    azureAccounts: value?.azureAccounts ?? [],
    onpremClusters: value?.onpremClusters ?? [],
    betterStackIntegrations: value?.betterStackIntegrations ?? [],
    uptimeKumaInstances: value?.uptimeKumaInstances ?? [],
    linearWorkspaces: value?.linearWorkspaces ?? [],
    jiraSites: value?.jiraSites ?? [],
    asanaAccounts: value?.asanaAccounts ?? [],
    sentryAccounts: value?.sentryAccounts ?? [],
    posthogIntegrations: value?.posthogIntegrations ?? [],
    tailscaleClients: value?.tailscaleClients ?? [],
    zeaburProviders: value?.zeaburProviders ?? [],
    vantaIntegrations: value?.vantaIntegrations ?? [],
    secureframeIntegrations: value?.secureframeIntegrations ?? [],
    resendIntegrations: value?.resendIntegrations ?? [],
    githubInstallations: value?.githubInstallations ?? [],
    gitlabBindings: value?.gitlabBindings ?? [],
    grafanaInstances: value?.grafanaInstances ?? [],
    sonarqubeIntegrations: value?.sonarqubeIntegrations ?? [],
    notionIntegrations: value?.notionIntegrations ?? [],
    upstashAccounts: value?.upstashAccounts ?? [],
    cloudflareAccounts: value?.cloudflareAccounts ?? [],
    devices: value?.devices ?? [],
  }
}

export function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function credentialSelectionSignature(value: AgentCredentialSelection): string {
  return JSON.stringify({
    awsRoleIds: sortedIds(value.awsRoleIds),
    gcpServiceAccountIds: sortedIds(value.gcpServiceAccountIds),
    linodeAccountIds: sortedIds(value.linodeAccountIds),
    hetznerAccountIds: sortedIds(value.hetznerAccountIds),
    tencentAccountIds: sortedIds(value.tencentAccountIds),
    aliyunAccountIds: sortedIds(value.aliyunAccountIds),
    volcengineAccountIds: sortedIds(value.volcengineAccountIds),
    huaweiAccountIds: sortedIds(value.huaweiAccountIds),
    azureAccountIds: sortedIds(value.azureAccountIds),
    onpremClusterIds: sortedIds(value.onpremClusterIds),
    betterStackIntegrationIds: sortedIds(value.betterStackIntegrationIds),
    uptimeKumaInstanceIds: sortedIds(value.uptimeKumaInstanceIds),
    linearWorkspaceIds: sortedIds(value.linearWorkspaceIds),
    jiraSiteIds: sortedIds(value.jiraSiteIds),
    asanaAccountIds: sortedIds(value.asanaAccountIds),
    sentryAccountIds: sortedIds(value.sentryAccountIds),
    posthogIntegrationIds: sortedIds(value.posthogIntegrationIds),
    tailscaleClientIds: sortedIds(value.tailscaleClientIds),
    zeaburIds: sortedIds(value.zeaburIds),
    vantaIntegrationIds: sortedIds(value.vantaIntegrationIds),
    secureframeIntegrationIds: sortedIds(value.secureframeIntegrationIds),
    resendIntegrationIds: sortedIds(value.resendIntegrationIds),
    githubInstallationIds: sortedIds(value.githubInstallationIds),
    gitlabBindingIds: sortedIds(value.gitlabBindingIds),
    grafanaInstanceIds: sortedIds(value.grafanaInstanceIds),
    sonarqubeIntegrationIds: sortedIds(value.sonarqubeIntegrationIds),
    notionIntegrationIds: sortedIds(value.notionIntegrationIds),
    upstashAccountIds: sortedIds(value.upstashAccountIds),
    cloudflareAccountIds: sortedIds(value.cloudflareAccountIds),
    deviceIds: sortedIds(value.deviceIds),
  })
}

export function allCredentialAccess(options: AgentCredentialOptions): AgentCredentialSelection {
  return {
    awsRoleIds: (options.awsRoles ?? []).map((role) => role.roleId),
    gcpServiceAccountIds: (options.gcpServiceAccounts ?? []).map(
      (account) => account.serviceAccountId,
    ),
    linodeAccountIds: (options.linodeAccounts ?? []).map((account) => account.accountId),
    hetznerAccountIds: (options.hetznerAccounts ?? []).map((account) => account.accountId),
    tencentAccountIds: (options.tencentAccounts ?? []).map((account) => account.accountId),
    aliyunAccountIds: (options.aliyunAccounts ?? []).map((account) => account.accountId),
    volcengineAccountIds: (options.volcengineAccounts ?? []).map((account) => account.accountId),
    huaweiAccountIds: (options.huaweiAccounts ?? []).map((account) => account.accountId),
    azureAccountIds: (options.azureAccounts ?? []).map((account) => account.accountId),
    onpremClusterIds: (options.onpremClusters ?? []).map((cluster) => cluster.clusterId),
    betterStackIntegrationIds: (options.betterStackIntegrations ?? []).map(
      (integration) => integration.integrationId,
    ),
    uptimeKumaInstanceIds: (options.uptimeKumaInstances ?? []).map(
      (instance) => instance.instanceId,
    ),
    linearWorkspaceIds: (options.linearWorkspaces ?? []).map((workspace) => workspace.workspaceId),
    jiraSiteIds: (options.jiraSites ?? []).map((site) => site.siteId),
    asanaAccountIds: (options.asanaAccounts ?? []).map((account) => account.accountId),
    sentryAccountIds: (options.sentryAccounts ?? []).map((account) => account.accountId),
    posthogIntegrationIds: (options.posthogIntegrations ?? []).map(
      (integration) => integration.integrationId,
    ),
    tailscaleClientIds: (options.tailscaleClients ?? []).map((client) => client.clientId),
    zeaburIds: (options.zeaburProviders ?? []).map((provider) => provider.zeaburId),
    vantaIntegrationIds: (options.vantaIntegrations ?? []).map(
      (integration) => integration.integrationId,
    ),
    secureframeIntegrationIds: (options.secureframeIntegrations ?? []).map(
      (integration) => integration.integrationId,
    ),
    resendIntegrationIds: (options.resendIntegrations ?? []).map(
      (integration) => integration.integrationId,
    ),
    githubInstallationIds: (options.githubInstallations ?? []).map(
      (installation) => installation.installationId,
    ),
    gitlabBindingIds: (options.gitlabBindings ?? []).map((binding) => binding.bindingId),
    grafanaInstanceIds: (options.grafanaInstances ?? []).map((instance) => instance.instanceId),
    sonarqubeIntegrationIds: (options.sonarqubeIntegrations ?? []).map(
      (integration) => integration.integrationId,
    ),
    notionIntegrationIds: (options.notionIntegrations ?? []).map(
      (integration) => integration.integrationId,
    ),
    upstashAccountIds: (options.upstashAccounts ?? []).map((account) => account.accountId),
    cloudflareAccountIds: (options.cloudflareAccounts ?? []).map((account) => account.accountId),
    deviceIds: (options.devices ?? []).map((device) => device.deviceId),
  }
}

// What a conversation starts with when the user hasn't chosen: everything they
// may use, minus Resend. Mirrors `allCredentialAccessFromOptions` in the
// backend's agent.ts — sending mail is irreversible and leaves the system, so a
// Resend binding is enabled for a conversation on purpose or not at all. Keep
// the two in step.
//
// Note this is deliberately NOT `allCredentialAccess` with a tweak: that one
// means "every id that exists" and is what prune/select-all need.
export function defaultCredentialAccess(options: AgentCredentialOptions): AgentCredentialSelection {
  return { ...allCredentialAccess(options), resendIntegrationIds: [] }
}

// Drop any selected credential ids that are no longer present in the available
// options — e.g. a connector deleted since this conversation last ran. Reuses
// `allCredentialAccess` (not `defaultCredentialAccess`) as the source of
// currently-valid ids per provider, so this stays correct as providers are
// added and an explicitly-enabled Resend binding survives a refresh instead of
// being pruned away.
export function pruneCredentialAccessToOptions(
  access: AgentCredentialSelection,
  options: AgentCredentialOptions,
): AgentCredentialSelection {
  return pruneSelectionToAvailable(access, allCredentialAccess(options))
}

// Options start out as a sentinel and are filled by an async fetch; pruning
// against the sentinel would blank a perfectly good stored selection, so the
// caller must know the difference between "nothing available" and "not loaded".
export function credentialOptionsLoaded(options: AgentCredentialOptions): boolean {
  return options !== EMPTY_CREDENTIAL_OPTIONS
}

export function reconcileStoredCredentialAccess(
  stored: Partial<AgentCredentialSelection> | null | undefined,
  options: AgentCredentialOptions,
): AgentCredentialSelection {
  if (!credentialOptionsLoaded(options)) {
    return normalizeCredentialAccess(stored ?? EMPTY_CREDENTIAL_ACCESS)
  }
  // No stored selection at all means "whatever this team has", not "nothing" —
  // but via `defaultCredentialAccess`, so Resend stays opt-in rather than being
  // switched on for every conversation that never made a choice.
  const normalized = normalizeCredentialAccess(stored ?? defaultCredentialAccess(options))

  return pruneSelectionToAvailable(normalized, allCredentialAccess(options))
}

export function emptyCredentialAccess(): AgentCredentialSelection {
  return {
    awsRoleIds: [],
    gcpServiceAccountIds: [],
    linodeAccountIds: [],
    hetznerAccountIds: [],
    tencentAccountIds: [],
    aliyunAccountIds: [],
    volcengineAccountIds: [],
    huaweiAccountIds: [],
    azureAccountIds: [],
    onpremClusterIds: [],
    betterStackIntegrationIds: [],
    uptimeKumaInstanceIds: [],
    linearWorkspaceIds: [],
    jiraSiteIds: [],
    asanaAccountIds: [],
    sentryAccountIds: [],
    posthogIntegrationIds: [],
    tailscaleClientIds: [],
    zeaburIds: [],
    vantaIntegrationIds: [],
    secureframeIntegrationIds: [],
    resendIntegrationIds: [],
    githubInstallationIds: [],
    gitlabBindingIds: [],
    grafanaInstanceIds: [],
    sonarqubeIntegrationIds: [],
    notionIntegrationIds: [],
    upstashAccountIds: [],
    cloudflareAccountIds: [],
    deviceIds: [],
  }
}

export function credentialOptionsCount(options: AgentCredentialOptions): number {
  return (
    (options.awsRoles ?? []).length +
    (options.gcpServiceAccounts ?? []).length +
    (options.linodeAccounts ?? []).length +
    (options.hetznerAccounts ?? []).length +
    (options.tencentAccounts ?? []).length +
    (options.aliyunAccounts ?? []).length +
    (options.volcengineAccounts ?? []).length +
    (options.huaweiAccounts ?? []).length +
    (options.azureAccounts ?? []).length +
    (options.onpremClusters ?? []).length +
    (options.betterStackIntegrations ?? []).length +
    (options.uptimeKumaInstances ?? []).length +
    (options.linearWorkspaces ?? []).length +
    (options.jiraSites ?? []).length +
    (options.asanaAccounts ?? []).length +
    (options.sentryAccounts ?? []).length +
    (options.posthogIntegrations ?? []).length +
    (options.tailscaleClients ?? []).length +
    (options.zeaburProviders ?? []).length +
    (options.vantaIntegrations ?? []).length +
    (options.secureframeIntegrations ?? []).length +
    (options.resendIntegrations ?? []).length +
    (options.githubInstallations ?? []).length +
    (options.gitlabBindings ?? []).length +
    (options.grafanaInstances ?? []).length +
    (options.sonarqubeIntegrations ?? []).length +
    (options.notionIntegrations ?? []).length +
    (options.upstashAccounts ?? []).length +
    (options.cloudflareAccounts ?? []).length +
    (options.devices ?? []).length
  )
}
