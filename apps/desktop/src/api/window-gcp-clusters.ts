import type { AwsLightsailInstance, SshSessionStart } from '../types/aws-compute.ts'
import type { GcpComputeInstance } from '../types/compute.ts'
import type {
  GcpCloudRunService,
  GcpMetricDescriptor,
  GcpMetricTimeSeriesQuery,
  GcpMetricTimeSeriesResult,
  GcpMonitoringDashboard,
  GcpMonitoringDashboardQueryResult,
  GcpMonitoringDashboardSummary,
  GcpMonitoringDashboardWidgetQuery,
} from '../types/gcp.ts'
import type {
  GrafanaInstance,
  OnpremCluster,
  OnpremClusterAccess,
  OnpremClusterConnection,
  OnpremClusterInstall,
} from '../types/onprem-git.ts'

export type WindowGcpClustersApi = {
  atlasListAwsLightsailInstances(
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ): Promise<AwsLightsailInstance[]>
  atlasRebootAwsLightsailInstance(
    teamId: string,
    accountId: string,
    name: string,
    region: string,
    roleId?: string,
  ): Promise<void>
  atlasStartAwsLightsailSsh(
    teamId: string,
    accountId: string,
    name: string,
    region: string,
    roleId?: string,
  ): Promise<SshSessionStart>
  atlasStartAwsEc2Ssh(
    teamId: string,
    accountId: string,
    instanceId: string,
    region?: string,
    username?: string,
    roleId?: string,
  ): Promise<SshSessionStart>
  atlasListGcpComputeInstances(
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ): Promise<GcpComputeInstance[]>
  atlasListGcpMetricDescriptors(
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ): Promise<GcpMetricDescriptor[]>
  atlasQueryGcpMetricTimeSeries(
    teamId: string,
    projectId: string,
    query: GcpMetricTimeSeriesQuery,
    serviceAccountId?: string,
  ): Promise<GcpMetricTimeSeriesResult>
  atlasListGcpMonitoringDashboards(
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ): Promise<GcpMonitoringDashboardSummary[]>
  atlasGetGcpMonitoringDashboard(
    teamId: string,
    projectId: string,
    dashboardId: string,
    serviceAccountId?: string,
  ): Promise<GcpMonitoringDashboard>
  atlasQueryGcpMonitoringDashboardWidget(
    teamId: string,
    projectId: string,
    dashboardId: string,
    widgetRef: string,
    query: GcpMonitoringDashboardWidgetQuery,
    serviceAccountId?: string,
  ): Promise<GcpMonitoringDashboardQueryResult>
  atlasListGcpCloudRunServices(
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ): Promise<GcpCloudRunService[]>
  atlasStartGcpComputeSsh(
    teamId: string,
    projectId: string,
    name: string,
    zone: string,
    serviceAccountId?: string,
  ): Promise<SshSessionStart>
  atlasUseAwsCluster(
    teamId: string,
    accountId: string,
    name: string,
    region?: string,
    roleId?: string,
  ): Promise<{ context: string; expiresAt: string | null }>
  atlasUseGcpCluster(
    teamId: string,
    projectId: string,
    name: string,
    location?: string,
    serviceAccountId?: string,
  ): Promise<{ context: string; expiresAt: string | null }>
  atlasUseOnpremCluster(teamId: string, clusterId: string): Promise<{ context: string }>
  atlasUseTencentCluster(
    teamId: string,
    accountId: string,
    clusterId: string,
    region?: string,
  ): Promise<{ context: string; expiresAt: string | null }>
  atlasUseAzureCluster(
    teamId: string,
    accountId: string,
    clusterName: string,
    resourceGroup?: string,
  ): Promise<{ context: string; expiresAt: string | null }>
  atlasUseAliyunCluster(
    teamId: string,
    accountId: string,
    clusterId: string,
    region?: string,
  ): Promise<{ context: string; expiresAt: string | null }>
  atlasUseVolcengineCluster(
    teamId: string,
    accountId: string,
    clusterId: string,
    region?: string,
    fresh?: boolean,
  ): Promise<{ context: string; expiresAt: string | null }>
  atlasListOnpremClusters(
    teamId: string,
  ): Promise<{ clusters: OnpremCluster[]; relayConfigured: boolean }>
  atlasEnrolOnpremCluster(
    teamId: string,
    label: string,
    kubeconfig?: string,
  ): Promise<{ cluster: OnpremCluster; install: OnpremClusterInstall }>
  atlasOnpremClusterConnection(teamId: string, clusterId: string): Promise<OnpremClusterConnection>
  atlasOnpremClusterAccess(teamId: string, clusterId: string): Promise<OnpremClusterAccess>
  atlasSetOnpremClusterKubeconfig(
    teamId: string,
    clusterId: string,
    kubeconfig: string,
  ): Promise<{ cluster: OnpremCluster }>
  atlasRotateOnpremClusterToken(
    teamId: string,
    clusterId: string,
  ): Promise<{ install: OnpremClusterInstall }>
  atlasDeleteOnpremCluster(teamId: string, clusterId: string): Promise<void>
  atlasListGrafanaInstances(teamId: string): Promise<GrafanaInstance[]>
  atlasBindGrafanaInstance(
    teamId: string,
    name: string,
    grafanaUrl: string,
    saToken: string,
  ): Promise<GrafanaInstance>
  atlasUnbindGrafanaInstance(teamId: string, instanceId: string): Promise<void>
  atlasGrafanaProxy<T>(
    teamId: string,
    instanceId: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T>
}
