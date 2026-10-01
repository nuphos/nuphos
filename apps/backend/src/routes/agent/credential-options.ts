import { isDevicePresent } from '@/lib/agent/devices/presence'
import { isActiveTeamMember, listAgentDevicesForUser } from '@/lib/agent/devices/store'
import { canUseAllowList } from '@/lib/byos/access'
import { extractAwsAccountId } from '@/lib/byos/account'
import { cachedAwsAccountAlias } from '@/lib/byos/aws'
import { parseObjectId } from '@/lib/objectid'
import { teamByosBindings } from '@/models'

import {
  connectorCredentialOptions,
  connectorCredentialOptionsProjection,
  emptyConnectorCredentialOptions,
} from './credential-options-connectors'

import type { AgentCredentialOptions } from './types'

// Only the user's own devices that allow local exec, in a team they belong to.
// No team means no devices.
export async function resolveDeviceOptions(
  userId: string,
  teamId: string | undefined,
): Promise<AgentCredentialOptions['devices']> {
  if (!teamId || !(await isActiveTeamMember(userId, teamId))) return []
  const devices = await listAgentDevicesForUser(userId)
  const candidates = devices.filter((device) => device.allowLocalExec)
  const eligible = await Promise.all(
    candidates.map(async (device) => await isDevicePresent(userId, device.deviceId)),
  )

  return candidates
    .filter((_, index) => eligible[index])
    .map((device) => ({
      deviceId: device.deviceId,
      label: device.label,
      platform: device.platform,
    }))
}

export async function getAgentCredentialOptions(
  teamId: string | undefined,
  userId: string,
): Promise<AgentCredentialOptions> {
  if (!teamId)
    return {
      awsRoles: [],
      gcpServiceAccounts: [],
      linodeAccounts: [],
      hetznerAccounts: [],
      tencentAccounts: [],
      aliyunAccounts: [],
      volcengineAccounts: [],
      azureAccounts: [],
      huaweiAccounts: [],
      onpremClusters: [],
      betterStackIntegrations: [],
      uptimeKumaInstances: [],
      linearWorkspaces: [],
      jiraSites: [],
      asanaAccounts: [],
      sentryAccounts: [],
      tailscaleClients: [],
      zeaburProviders: [],
      vantaIntegrations: [],
      secureframeIntegrations: [],
      resendIntegrations: [],
      devices: [],
      ...emptyConnectorCredentialOptions(),
    }
  const teamObjectId = parseObjectId(teamId, 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamObjectId },
    {
      projection: {
        awsRoles: 1,
        gcpServiceAccounts: 1,
        linodeAccounts: 1,
        hetznerAccounts: 1,
        tencentAccounts: 1,
        aliyunAccounts: 1,
        volcengineAccounts: 1,
        azureAccounts: 1,
        huaweiAccounts: 1,
        onpremClusters: 1,
        betterStackIntegrations: 1,
        uptimeKumaInstances: 1,
        linearWorkspaces: 1,
        jiraSites: 1,
        asanaAccounts: 1,
        sentryAccounts: 1,
        tailscaleClients: 1,
        vantaIntegrations: 1,
        secureframeIntegrations: 1,
        resendIntegrations: 1,
        zeaburProviders: 1,
        ...connectorCredentialOptionsProjection,
      },
    },
  )
  const awsRoles = (doc?.awsRoles ?? [])
    // Permission-admin bindings are human-only; never offer them to the agent.
    .filter((binding) => binding.purpose !== 'permission-admin')
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .flatMap((binding) => {
      const accountId = extractAwsAccountId(binding.roleArn)

      return accountId
        ? [
            {
              roleId: binding.id.toHexString(),
              accountId,
              accountAlias: cachedAwsAccountAlias(binding.roleArn),
              roleArn: binding.roleArn,
            },
          ]
        : []
    })
  const gcpServiceAccounts = (doc?.gcpServiceAccounts ?? [])
    // Permission-admin bindings are human-only; never offer them to the agent.
    .filter((binding) => binding.purpose !== 'permission-admin')
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      serviceAccountId: binding.id.toHexString(),
      projectId: binding.projectId,
      serviceAccountEmail: binding.serviceAccountEmail,
    }))
  const zeaburProviders = (doc?.zeaburProviders ?? []).flatMap((binding) =>
    (binding.identities ?? []).map((identity) => ({
      zeaburId: identity.zeaburId,
      kind: identity.kind,
      name: identity.name,
    })),
  )
  const linodeAccounts = (doc?.linodeAccounts ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      accountId: binding.id.toHexString(),
      label: binding.label,
    }))
  const hetznerAccounts = (doc?.hetznerAccounts ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      accountId: binding.id.toHexString(),
      label: binding.label,
    }))
  const tencentAccounts = (doc?.tencentAccounts ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      accountId: binding.id.toHexString(),
      label: binding.label,
      roleArn: binding.roleArn,
    }))
  const aliyunAccounts = (doc?.aliyunAccounts ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      accountId: binding.id.toHexString(),
      label: binding.label,
      roleArn: binding.roleArn,
    }))
  const volcengineAccounts = (doc?.volcengineAccounts ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      accountId: binding.id.toHexString(),
      label: binding.label,
      roleTrn: binding.roleTrn,
    }))
  const azureAccounts = (doc?.azureAccounts ?? [])
    // Permission-admin bindings are human-only; never offer them to the agent.
    .filter((binding) => binding.purpose !== 'permission-admin')
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      accountId: binding.id.toHexString(),
      label: binding.label,
      subscriptionId: binding.subscriptionId,
    }))
  const huaweiAccounts = (doc?.huaweiAccounts ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      accountId: binding.id.toHexString(),
      label: binding.label,
      domainId: binding.domainId,
      idpId: binding.idpId,
    }))
  const onpremClusters = (doc?.onpremClusters ?? [])
    .filter((binding) => Boolean(binding.encryptedKubeconfig))
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      clusterId: binding.id.toHexString(),
      label: binding.label,
      contextName: `onprem/${binding.label}/cluster`,
    }))
  const betterStackIntegrations = (doc?.betterStackIntegrations ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      integrationId: binding.id.toHexString(),
      label: binding.label,
      hasUptimeApiToken: Boolean(binding.encryptedUptimeApiToken),
      hasTelemetryApiToken: Boolean(binding.encryptedTelemetryApiToken),
    }))
  const uptimeKumaInstances = (doc?.uptimeKumaInstances ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      instanceId: binding.id.toHexString(),
      label: binding.label,
      baseUrl: binding.baseUrl,
      authType: binding.encryptedAuthToken ? ('token' as const) : ('password' as const),
    }))
  const linearWorkspaces = (doc?.linearWorkspaces ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      workspaceId: binding.id.toHexString(),
      label: binding.label,
      workspaceName: binding.workspaceName,
    }))
  const jiraSites = (doc?.jiraSites ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      siteId: binding.id.toHexString(),
      label: binding.label,
      siteUrl: binding.siteUrl,
    }))
  const asanaAccounts = (doc?.asanaAccounts ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      accountId: binding.id.toHexString(),
      label: binding.label,
      accountEmail: binding.accountEmail,
    }))
  const sentryAccounts = (doc?.sentryAccounts ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      accountId: binding.id.toHexString(),
      label: binding.label,
      userEmail: binding.userEmail,
    }))
  const tailscaleClients = (doc?.tailscaleClients ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      clientId: binding.id.toHexString(),
      label: binding.label,
      oauthClientId: binding.clientId,
    }))
  const vantaIntegrations = (doc?.vantaIntegrations ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      integrationId: binding.id.toHexString(),
      label: binding.label,
      authType: binding.authType,
    }))
  const secureframeIntegrations = (doc?.secureframeIntegrations ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      integrationId: binding.id.toHexString(),
      label: binding.label,
      region: binding.region,
    }))
  const resendIntegrations = (doc?.resendIntegrations ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      integrationId: binding.id.toHexString(),
      label: binding.label,
      permission: binding.permission,
    }))
  const devices = await resolveDeviceOptions(userId, teamId)

  return {
    awsRoles,
    gcpServiceAccounts,
    linodeAccounts,
    hetznerAccounts,
    tencentAccounts,
    aliyunAccounts,
    volcengineAccounts,
    azureAccounts,
    huaweiAccounts,
    onpremClusters,
    betterStackIntegrations,
    uptimeKumaInstances,
    linearWorkspaces,
    jiraSites,
    asanaAccounts,
    sentryAccounts,
    tailscaleClients,
    zeaburProviders,
    vantaIntegrations,
    secureframeIntegrations,
    resendIntegrations,
    devices,
    ...connectorCredentialOptions(doc, userId),
  }
}

// The default access a conversation gets when the caller made no explicit
// selection: everything the user may use. Resend is the one exception — see
// below.
