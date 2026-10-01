import type { GcpMetricTimeSeriesQuery, GcpMonitoringDashboardWidgetQuery } from '../types/gcp.ts'

export const gcpClustersApi = {
  atlasListAwsLightsailInstances: (
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ) => window.api.atlasListAwsLightsailInstances(teamId, accountId, region, roleId),
  atlasRebootAwsLightsailInstance: (
    teamId: string,
    accountId: string,
    name: string,
    region: string,
    roleId?: string,
  ) => window.api.atlasRebootAwsLightsailInstance(teamId, accountId, name, region, roleId),
  atlasStartAwsLightsailSsh: (
    teamId: string,
    accountId: string,
    name: string,
    region: string,
    roleId?: string,
  ) => window.api.atlasStartAwsLightsailSsh(teamId, accountId, name, region, roleId),
  atlasStartAwsEc2Ssh: (
    teamId: string,
    accountId: string,
    instanceId: string,
    region?: string,
    username?: string,
    roleId?: string,
  ) => window.api.atlasStartAwsEc2Ssh(teamId, accountId, instanceId, region, username, roleId),
  atlasListGcpComputeInstances: (teamId: string, projectId: string, serviceAccountId?: string) =>
    window.api.atlasListGcpComputeInstances(teamId, projectId, serviceAccountId),
  atlasListGcpMetricDescriptors: (teamId: string, projectId: string, serviceAccountId?: string) =>
    window.api.atlasListGcpMetricDescriptors(teamId, projectId, serviceAccountId),
  atlasQueryGcpMetricTimeSeries: (
    teamId: string,
    projectId: string,
    query: GcpMetricTimeSeriesQuery,
    serviceAccountId?: string,
  ) => window.api.atlasQueryGcpMetricTimeSeries(teamId, projectId, query, serviceAccountId),
  atlasListGcpMonitoringDashboards: (
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ) => window.api.atlasListGcpMonitoringDashboards(teamId, projectId, serviceAccountId),
  atlasGetGcpMonitoringDashboard: (
    teamId: string,
    projectId: string,
    dashboardId: string,
    serviceAccountId?: string,
  ) => window.api.atlasGetGcpMonitoringDashboard(teamId, projectId, dashboardId, serviceAccountId),
  atlasQueryGcpMonitoringDashboardWidget: (
    teamId: string,
    projectId: string,
    dashboardId: string,
    widgetRef: string,
    query: GcpMonitoringDashboardWidgetQuery,
    serviceAccountId?: string,
  ) =>
    window.api.atlasQueryGcpMonitoringDashboardWidget(
      teamId,
      projectId,
      dashboardId,
      widgetRef,
      query,
      serviceAccountId,
    ),
  atlasListGcpCloudRunServices: (teamId: string, projectId: string, serviceAccountId?: string) =>
    window.api.atlasListGcpCloudRunServices(teamId, projectId, serviceAccountId),
  atlasStartGcpComputeSsh: (
    teamId: string,
    projectId: string,
    name: string,
    zone: string,
    serviceAccountId?: string,
  ) => window.api.atlasStartGcpComputeSsh(teamId, projectId, name, zone, serviceAccountId),
  atlasUseAwsCluster: (
    teamId: string,
    accountId: string,
    name: string,
    region?: string,
    roleId?: string,
  ) => window.api.atlasUseAwsCluster(teamId, accountId, name, region, roleId),
  atlasUseGcpCluster: (
    teamId: string,
    projectId: string,
    name: string,
    location?: string,
    serviceAccountId?: string,
  ) => window.api.atlasUseGcpCluster(teamId, projectId, name, location, serviceAccountId),
  atlasUseOnpremCluster: (teamId: string, clusterId: string) =>
    window.api.atlasUseOnpremCluster(teamId, clusterId),
  atlasUseTencentCluster: (teamId: string, accountId: string, clusterId: string, region?: string) =>
    window.api.atlasUseTencentCluster(teamId, accountId, clusterId, region),
  atlasUseAliyunCluster: (teamId: string, accountId: string, clusterId: string, region?: string) =>
    window.api.atlasUseAliyunCluster(teamId, accountId, clusterId, region),
  atlasUseVolcengineCluster: (
    teamId: string,
    accountId: string,
    clusterId: string,
    region?: string,
    // Issue a fresh credential — VKE RBAC grants only apply to kubeconfigs
    // issued after the grant (RBAC mask re-check path).
    fresh?: boolean,
  ) => window.api.atlasUseVolcengineCluster(teamId, accountId, clusterId, region, fresh),
  atlasListOnpremClusters: (teamId: string) => window.api.atlasListOnpremClusters(teamId),
  atlasEnrolOnpremCluster: (teamId: string, label: string, kubeconfig?: string) =>
    window.api.atlasEnrolOnpremCluster(teamId, label, kubeconfig),
  atlasOnpremClusterConnection: (teamId: string, clusterId: string) =>
    window.api.atlasOnpremClusterConnection(teamId, clusterId),
  atlasOnpremClusterAccess: (teamId: string, clusterId: string) =>
    window.api.atlasOnpremClusterAccess(teamId, clusterId),
  atlasSetOnpremClusterKubeconfig: (teamId: string, clusterId: string, kubeconfig: string) =>
    window.api.atlasSetOnpremClusterKubeconfig(teamId, clusterId, kubeconfig),
  atlasRotateOnpremClusterToken: (teamId: string, clusterId: string) =>
    window.api.atlasRotateOnpremClusterToken(teamId, clusterId),
  atlasDeleteOnpremCluster: (teamId: string, clusterId: string) =>
    window.api.atlasDeleteOnpremCluster(teamId, clusterId),
  atlasListGrafanaInstances: (teamId: string) => window.api.atlasListGrafanaInstances(teamId),
  atlasBindGrafanaInstance: (teamId: string, name: string, grafanaUrl: string, saToken: string) =>
    window.api.atlasBindGrafanaInstance(teamId, name, grafanaUrl, saToken),
  atlasUnbindGrafanaInstance: (teamId: string, instanceId: string) =>
    window.api.atlasUnbindGrafanaInstance(teamId, instanceId),
  atlasGrafanaProxy: <T>(
    teamId: string,
    instanceId: string,
    method: string,
    path: string,
    body?: unknown,
  ) => window.api.atlasGrafanaProxy<T>(teamId, instanceId, method, path, body),
}
