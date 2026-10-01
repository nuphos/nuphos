import type {
  BetterStackCollector,
  BetterStackDashboard,
  BetterStackHeartbeat,
  BetterStackIncident,
  BetterStackIntegration,
  BetterStackMonitor,
  BetterStackSource,
  UptimeKumaInstance,
} from '../types/infra-integrations.ts'
import type { BindingAccess } from '../types/k8s-core.ts'
import type { AwsAccount, CloudflareAccount, GcpProject } from '../types/provider-accounts.ts'

export type WindowProviderAccessApi = {
  atlasBindAwsAccount(teamId: string, roleArn: string): Promise<AwsAccount>
  atlasUnbindAwsAccount(teamId: string, accountId: string, roleId?: string): Promise<void>
  atlasGetAwsAccountAccess(
    teamId: string,
    accountId: string,
    roleId?: string,
  ): Promise<BindingAccess>
  atlasUpdateAwsAccountAccess(
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
    roleId?: string,
  ): Promise<BindingAccess>
  atlasBindGcpProject(
    teamId: string,
    serviceAccountEmail: string,
    projectId: string,
  ): Promise<GcpProject>
  atlasUnbindGcpProject(teamId: string, projectId: string, serviceAccountId?: string): Promise<void>
  atlasGetGcpProjectAccess(
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ): Promise<BindingAccess>
  atlasUpdateGcpProjectAccess(
    teamId: string,
    projectId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
    serviceAccountId?: string,
  ): Promise<BindingAccess>
  atlasBindCloudflareAccount(
    teamId: string,
    accountId: string,
    apiKey: string,
  ): Promise<CloudflareAccount>
  atlasUnbindCloudflareAccount(teamId: string, accountId: string): Promise<void>
  atlasListBetterStackIntegrations(teamId: string): Promise<BetterStackIntegration[]>
  atlasBindBetterStackIntegration(
    teamId: string,
    label: string,
    uptimeApiToken: string | null,
    telemetryApiToken: string | null,
  ): Promise<BetterStackIntegration>
  atlasUpdateBetterStackIntegration(
    teamId: string,
    integrationId: string,
    patch: {
      label?: string
      uptimeApiToken?: string | null
      telemetryApiToken?: string | null
    },
  ): Promise<BetterStackIntegration>
  atlasUnbindBetterStackIntegration(teamId: string, integrationId: string): Promise<void>
  atlasListBetterStackMonitors(teamId: string, integrationId: string): Promise<BetterStackMonitor[]>
  atlasListBetterStackHeartbeats(
    teamId: string,
    integrationId: string,
  ): Promise<BetterStackHeartbeat[]>
  atlasListBetterStackIncidents(
    teamId: string,
    integrationId: string,
  ): Promise<BetterStackIncident[]>
  atlasListBetterStackDashboards(
    teamId: string,
    integrationId: string,
  ): Promise<BetterStackDashboard[]>
  atlasListBetterStackSources(teamId: string, integrationId: string): Promise<BetterStackSource[]>
  atlasListBetterStackCollectors(
    teamId: string,
    integrationId: string,
  ): Promise<BetterStackCollector[]>
  atlasListUptimeKumaInstances(teamId: string): Promise<UptimeKumaInstance[]>
}
