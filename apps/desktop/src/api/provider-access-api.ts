import type { BindingAccess } from '../types/k8s-core.ts'

export const providerAccessApi = {
  atlasBindAwsAccount: (teamId: string, roleArn: string) =>
    window.api.atlasBindAwsAccount(teamId, roleArn),
  atlasUnbindAwsAccount: (teamId: string, accountId: string, roleId?: string) =>
    window.api.atlasUnbindAwsAccount(teamId, accountId, roleId),
  atlasGetAwsAccountAccess: (teamId: string, accountId: string, roleId?: string) =>
    window.api.atlasGetAwsAccountAccess(teamId, accountId, roleId),
  atlasUpdateAwsAccountAccess: (
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
    roleId?: string,
  ) => window.api.atlasUpdateAwsAccountAccess(teamId, accountId, access, roleId),
  atlasBindGcpProject: (teamId: string, serviceAccountEmail: string, projectId: string) =>
    window.api.atlasBindGcpProject(teamId, serviceAccountEmail, projectId),
  atlasUnbindGcpProject: (teamId: string, projectId: string, serviceAccountId?: string) =>
    window.api.atlasUnbindGcpProject(teamId, projectId, serviceAccountId),
  atlasGetGcpProjectAccess: (teamId: string, projectId: string, serviceAccountId?: string) =>
    window.api.atlasGetGcpProjectAccess(teamId, projectId, serviceAccountId),
  atlasUpdateGcpProjectAccess: (
    teamId: string,
    projectId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
    serviceAccountId?: string,
  ) => window.api.atlasUpdateGcpProjectAccess(teamId, projectId, access, serviceAccountId),
  atlasBindCloudflareAccount: (teamId: string, accountId: string, apiKey: string) =>
    window.api.atlasBindCloudflareAccount(teamId, accountId, apiKey),
  atlasUnbindCloudflareAccount: (teamId: string, accountId: string) =>
    window.api.atlasUnbindCloudflareAccount(teamId, accountId),
  atlasListBetterStackIntegrations: (teamId: string) =>
    window.api.atlasListBetterStackIntegrations(teamId),
  atlasBindBetterStackIntegration: (
    teamId: string,
    label: string,
    uptimeApiToken: string | null,
    telemetryApiToken: string | null,
  ) => window.api.atlasBindBetterStackIntegration(teamId, label, uptimeApiToken, telemetryApiToken),
  atlasUpdateBetterStackIntegration: (
    teamId: string,
    integrationId: string,
    patch: {
      label?: string
      uptimeApiToken?: string | null
      telemetryApiToken?: string | null
    },
  ) => window.api.atlasUpdateBetterStackIntegration(teamId, integrationId, patch),
  atlasUnbindBetterStackIntegration: (teamId: string, integrationId: string) =>
    window.api.atlasUnbindBetterStackIntegration(teamId, integrationId),
  atlasListBetterStackMonitors: (teamId: string, integrationId: string) =>
    window.api.atlasListBetterStackMonitors(teamId, integrationId),
  atlasListBetterStackHeartbeats: (teamId: string, integrationId: string) =>
    window.api.atlasListBetterStackHeartbeats(teamId, integrationId),
  atlasListBetterStackIncidents: (teamId: string, integrationId: string) =>
    window.api.atlasListBetterStackIncidents(teamId, integrationId),
  atlasListBetterStackDashboards: (teamId: string, integrationId: string) =>
    window.api.atlasListBetterStackDashboards(teamId, integrationId),
  atlasListBetterStackSources: (teamId: string, integrationId: string) =>
    window.api.atlasListBetterStackSources(teamId, integrationId),
  atlasListBetterStackCollectors: (teamId: string, integrationId: string) =>
    window.api.atlasListBetterStackCollectors(teamId, integrationId),
  atlasListUptimeKumaInstances: (teamId: string) => window.api.atlasListUptimeKumaInstances(teamId),
}
