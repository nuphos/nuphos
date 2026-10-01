import { getAgentCredentialOptions } from './credential-options'
import { resolveConnectorCredentialAccess } from './credential-resolve-connectors'
import { includeBoundOnpremCluster } from './credential-resolve-onprem'
import { normalizeCredentialSelection } from './team-scope'

import type { AgentCredentialOptions, AgentCredentialSelection } from './types'
import type { AgentCredentialAccess } from '@/lib/agent/db'

const byAccountId = (account: { accountId: string }) => account.accountId
const byIntegrationId = (integration: { integrationId: string }) => integration.integrationId

function keep<T>(selected: string[] | undefined, available: T[], idOf: (item: T) => string) {
  const allowed = new Set(available.map(idOf))

  return selected?.filter((id) => allowed.has(id)) ?? []
}

export async function resolveAgentCredentialAccess(params: {
  teamId: string | undefined
  userId: string
  selection?: unknown
  stored?: AgentCredentialAccess
  kubeContext?: string
}): Promise<{ access: AgentCredentialAccess; options: AgentCredentialOptions }> {
  const options = await getAgentCredentialOptions(params.teamId, params.userId)

  return {
    options,
    access: {
      ...availableCredentialAccess(
        normalizeCredentialSelection(withOmittedKeysFromStored(params.selection, params.stored)),
        options,
        params.kubeContext,
      ),
      updatedAt: new Date(),
      updatedBy: params.userId,
    },
  }
}

// A client that predates a selection key omits it; keep the stored value for
// that key instead of letting the omission clear it. An explicit [] still clears.
export function withOmittedKeysFromStored(
  selection: unknown,
  stored: AgentCredentialAccess | undefined,
): unknown {
  if (!stored || !selection || typeof selection !== 'object') return selection
  const merged: Record<string, unknown> = { ...(selection as Record<string, unknown>) }

  for (const [key, value] of Object.entries(stored)) {
    if (Array.isArray(value) && merged[key] === undefined) merged[key] = value
  }

  return merged
}

// Ids outside `options` are dropped rather than refused: a deleted connector and
// one the caller was never granted look the same here, and neither is reachable.
export function availableCredentialAccess(
  selection: AgentCredentialSelection,
  options: AgentCredentialOptions,
  kubeContext?: string,
): Omit<AgentCredentialAccess, 'updatedAt' | 'updatedBy'> {
  const onpremClusterIds = includeBoundOnpremCluster(
    keep(selection.onpremClusterIds, options.onpremClusters, (cluster) => cluster.clusterId),
    options.onpremClusters,
    kubeContext,
  )

  return {
    awsRoleIds: keep(selection.awsRoleIds, options.awsRoles, (role) => role.roleId),
    gcpServiceAccountIds: keep(
      selection.gcpServiceAccountIds,
      options.gcpServiceAccounts,
      (account) => account.serviceAccountId,
    ),
    linodeAccountIds: keep(selection.linodeAccountIds, options.linodeAccounts, byAccountId),
    hetznerAccountIds: keep(selection.hetznerAccountIds, options.hetznerAccounts, byAccountId),
    tencentAccountIds: keep(selection.tencentAccountIds, options.tencentAccounts, byAccountId),
    aliyunAccountIds: keep(selection.aliyunAccountIds, options.aliyunAccounts, byAccountId),
    volcengineAccountIds: keep(
      selection.volcengineAccountIds,
      options.volcengineAccounts,
      byAccountId,
    ),
    azureAccountIds: keep(selection.azureAccountIds, options.azureAccounts, byAccountId),
    huaweiAccountIds: keep(selection.huaweiAccountIds, options.huaweiAccounts, byAccountId),
    onpremClusterIds,
    betterStackIntegrationIds: keep(
      selection.betterStackIntegrationIds,
      options.betterStackIntegrations,
      byIntegrationId,
    ),
    uptimeKumaInstanceIds: keep(
      selection.uptimeKumaInstanceIds,
      options.uptimeKumaInstances,
      (instance) => instance.instanceId,
    ),
    linearWorkspaceIds: keep(
      selection.linearWorkspaceIds,
      options.linearWorkspaces,
      (workspace) => workspace.workspaceId,
    ),
    jiraSiteIds: keep(selection.jiraSiteIds, options.jiraSites, (site) => site.siteId),
    asanaAccountIds: keep(selection.asanaAccountIds, options.asanaAccounts, byAccountId),
    sentryAccountIds: keep(selection.sentryAccountIds, options.sentryAccounts, byAccountId),
    tailscaleClientIds: keep(
      selection.tailscaleClientIds,
      options.tailscaleClients,
      (client) => client.clientId,
    ),
    zeaburIds: keep(selection.zeaburIds, options.zeaburProviders, (provider) => provider.zeaburId),
    vantaIntegrationIds: keep(
      selection.vantaIntegrationIds,
      options.vantaIntegrations,
      byIntegrationId,
    ),
    secureframeIntegrationIds: keep(
      selection.secureframeIntegrationIds,
      options.secureframeIntegrations,
      byIntegrationId,
    ),
    resendIntegrationIds: keep(
      selection.resendIntegrationIds,
      options.resendIntegrations,
      byIntegrationId,
    ),
    posthogIntegrationIds: keep(
      selection.posthogIntegrationIds,
      options.posthogIntegrations,
      byIntegrationId,
    ),
    // A device drops out of availability the moment it goes offline or its
    // owner flips the local toggle off — no error, it just silently stops
    // being selectable for this turn (the tool's own execute() is the second
    // line of defense if the model targets it anyway).
    deviceIds: keep(selection.deviceIds, options.devices, (device) => device.deviceId),
    ...resolveConnectorCredentialAccess(selection, options),
  }
}
