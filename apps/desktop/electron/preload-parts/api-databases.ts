import { ipcRenderer } from 'electron'

export const databasesApi = {
  atlasTestDatabaseConnectionInput: (
    teamId: string,
    input: {
      engine: 'mongodb' | 'postgresql' | 'mysql'
      connectionUri: string
      networkMode: 'public' | 'tailscale' | 'cluster-relay'
      tailscale?: { bindingId: string; tag: string }
    },
  ) => ipcRenderer.invoke('atlas:testDatabaseConnectionInput', teamId, input),
  atlasCreateDatabaseConnection: (teamId: string, input: unknown) =>
    ipcRenderer.invoke('atlas:createDatabaseConnection', teamId, input),
  atlasUpdateDatabaseConnection: (teamId: string, connectionId: string, patch: unknown) =>
    ipcRenderer.invoke('atlas:updateDatabaseConnection', teamId, connectionId, patch),
  atlasTestStoredDatabaseConnection: (teamId: string, connectionId: string) =>
    ipcRenderer.invoke('atlas:testStoredDatabaseConnection', teamId, connectionId),
  atlasDeleteDatabaseConnection: (teamId: string, connectionId: string) =>
    ipcRenderer.invoke('atlas:deleteDatabaseConnection', teamId, connectionId),
  atlasBindUptimeKumaInstance: (
    teamId: string,
    input: {
      label: string
      baseUrl: string
      username?: string | null
      password?: string | null
      authToken?: string | null
    },
  ) => ipcRenderer.invoke('atlas:bindUptimeKumaInstance', teamId, input),
  atlasUpdateUptimeKumaInstance: (
    teamId: string,
    instanceId: string,
    patch: {
      label?: string
      baseUrl?: string
      username?: string | null
      password?: string | null
      authToken?: string | null
    },
  ) => ipcRenderer.invoke('atlas:updateUptimeKumaInstance', teamId, instanceId, patch),
  atlasUnbindUptimeKumaInstance: (teamId: string, instanceId: string) =>
    ipcRenderer.invoke('atlas:unbindUptimeKumaInstance', teamId, instanceId),
  atlasListUptimeKumaMonitors: (teamId: string, instanceId: string) =>
    ipcRenderer.invoke('atlas:listUptimeKumaMonitors', teamId, instanceId),
  atlasGetUptimeKumaMonitor: (teamId: string, instanceId: string, monitorId: number) =>
    ipcRenderer.invoke('atlas:getUptimeKumaMonitor', teamId, instanceId, monitorId),
  atlasCreateUptimeKumaMonitor: (
    teamId: string,
    instanceId: string,
    input: Record<string, unknown>,
  ) => ipcRenderer.invoke('atlas:createUptimeKumaMonitor', teamId, instanceId, input),
  atlasUpdateUptimeKumaMonitor: (
    teamId: string,
    instanceId: string,
    monitorId: number,
    patch: Record<string, unknown>,
  ) => ipcRenderer.invoke('atlas:updateUptimeKumaMonitor', teamId, instanceId, monitorId, patch),
  atlasPauseUptimeKumaMonitor: (teamId: string, instanceId: string, monitorId: number) =>
    ipcRenderer.invoke('atlas:pauseUptimeKumaMonitor', teamId, instanceId, monitorId),
  atlasResumeUptimeKumaMonitor: (teamId: string, instanceId: string, monitorId: number) =>
    ipcRenderer.invoke('atlas:resumeUptimeKumaMonitor', teamId, instanceId, monitorId),
  atlasGetMonitoringOverview: (teamId: string) =>
    ipcRenderer.invoke('atlas:getMonitoringOverview', teamId),
  fileTransferUpload: (args: {
    teamId: string
    sessionId?: string
    filePaths: string[]
    label?: string
  }) => ipcRenderer.invoke('fileTransfer:upload', args),
  fileTransferResolve: (args: { teamId: string; sessionId?: string; groupId: string }) =>
    ipcRenderer.invoke('fileTransfer:resolve', args),
  fileTransferListDownloads: (args: { teamId: string; sessionId?: string }) =>
    ipcRenderer.invoke('fileTransfer:listDownloads', args),
  fileTransferRevealInFolder: (path: string) =>
    ipcRenderer.invoke('fileTransfer:revealInFolder', path),
  readImageAttachment: (path: string) => ipcRenderer.invoke('attachment:readImage', path),
  attachmentDirectoryPaths: (paths: string[]) =>
    ipcRenderer.invoke('attachment:directoryPaths', paths),
  fileTransferDownloadOne: (args: {
    teamId: string
    sessionId?: string
    groupId: string
    fileId: string
    fileName: string
  }) => ipcRenderer.invoke('fileTransfer:downloadOne', args),
  fileTransferDownloadAllZip: (args: {
    teamId: string
    sessionId?: string
    groupId: string
    zipName: string
  }) => ipcRenderer.invoke('fileTransfer:downloadAllZip', args),
  atlasDeleteBetterStackMonitor: (teamId: string, integrationId: string, monitorId: string) =>
    ipcRenderer.invoke('atlas:deleteBetterStackMonitor', teamId, integrationId, monitorId),
  atlasDeleteBetterStackHeartbeat: (teamId: string, integrationId: string, heartbeatId: string) =>
    ipcRenderer.invoke('atlas:deleteBetterStackHeartbeat', teamId, integrationId, heartbeatId),
  atlasDeleteUptimeKumaMonitor: (
    teamId: string,
    instanceId: string,
    monitorId: number,
    deleteChildren?: boolean,
  ) =>
    ipcRenderer.invoke(
      'atlas:deleteUptimeKumaMonitor',
      teamId,
      instanceId,
      monitorId,
      deleteChildren,
    ),
  atlasListAwsVpcs: (teamId: string, accountId: string, region?: string, roleId?: string) =>
    ipcRenderer.invoke('atlas:listAwsVpcs', teamId, accountId, region, roleId),
  atlasListAwsNacls: (
    teamId: string,
    accountId: string,
    region?: string,
    vpcId?: string,
    roleId?: string,
  ) => ipcRenderer.invoke('atlas:listAwsNacls', teamId, accountId, region, vpcId, roleId),
  atlasListAwsClusters: (teamId: string, accountId: string, roleId?: string) =>
    ipcRenderer.invoke('atlas:listAwsClusters', teamId, accountId, roleId),
  atlasGetAwsIamPermissions: (teamId: string, accountId: string, roleId?: string) =>
    ipcRenderer.invoke('atlas:getAwsIamPermissions', teamId, accountId, roleId),
  atlasListPermissionGrantProposals: (teamId: string) =>
    ipcRenderer.invoke('atlas:listPermissionGrantProposals', teamId),
  atlasGetPermissionGrantProposal: (teamId: string, id: string) =>
    ipcRenderer.invoke('atlas:getPermissionGrantProposal', teamId, id),
  atlasApprovePermissionGrantProposal: (teamId: string, id: string) =>
    ipcRenderer.invoke('atlas:approvePermissionGrantProposal', teamId, id),
  atlasRejectPermissionGrantProposal: (teamId: string, id: string) =>
    ipcRenderer.invoke('atlas:rejectPermissionGrantProposal', teamId, id),
  atlasGetGcpIamPermissions: (teamId: string, projectId: string, serviceAccountId?: string) =>
    ipcRenderer.invoke('atlas:getGcpIamPermissions', teamId, projectId, serviceAccountId),
  atlasGetCloudflareIamPermissions: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:getCloudflareIamPermissions', teamId, accountId),
  atlasListGcpVpcs: (teamId: string, projectId: string, serviceAccountId?: string) =>
    ipcRenderer.invoke('atlas:listGcpVpcs', teamId, projectId, serviceAccountId),
  atlasListGcpFirewalls: (teamId: string, projectId: string, serviceAccountId?: string) =>
    ipcRenderer.invoke('atlas:listGcpFirewalls', teamId, projectId, serviceAccountId),
  atlasListGcpClusters: (teamId: string, projectId: string, serviceAccountId?: string) =>
    ipcRenderer.invoke('atlas:listGcpClusters', teamId, projectId, serviceAccountId),
  atlasListAwsEc2Instances: (teamId: string, accountId: string, region?: string, roleId?: string) =>
    ipcRenderer.invoke('atlas:listAwsEc2Instances', teamId, accountId, region, roleId),
  atlasListAwsEcsClusters: (teamId: string, accountId: string, region?: string, roleId?: string) =>
    ipcRenderer.invoke('atlas:listAwsEcsClusters', teamId, accountId, region, roleId),
  atlasListAwsEcsServices: (
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    roleId?: string,
  ) =>
    ipcRenderer.invoke('atlas:listAwsEcsServices', teamId, accountId, region, clusterName, roleId),
  atlasListAwsEcsTasks: (
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    desiredStatus?: 'RUNNING' | 'STOPPED',
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:listAwsEcsTasks',
      teamId,
      accountId,
      region,
      clusterName,
      desiredStatus,
      roleId,
    ),
  atlasListAwsEcsContainerInstances: (
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:listAwsEcsContainerInstances',
      teamId,
      accountId,
      region,
      clusterName,
      roleId,
    ),
  atlasGetAwsEcsClusterMetrics: (
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    rangeMinutes?: number,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:getAwsEcsClusterMetrics',
      teamId,
      accountId,
      region,
      clusterName,
      rangeMinutes,
      roleId,
    ),
  atlasListAwsCfnStacks: (teamId: string, accountId: string, region?: string, roleId?: string) =>
    ipcRenderer.invoke('atlas:listAwsCfnStacks', teamId, accountId, region, roleId),
  atlasListAwsS3Buckets: (teamId: string, accountId: string, roleId?: string) =>
    ipcRenderer.invoke('atlas:listAwsS3Buckets', teamId, accountId, roleId),
  atlasListAwsS3BucketObjects: (
    teamId: string,
    accountId: string,
    bucket: string,
    region: string,
    prefix: string,
    continuationToken: string | null,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:listAwsS3BucketObjects',
      teamId,
      accountId,
      bucket,
      region,
      prefix,
      continuationToken,
      roleId,
    ),
  atlasGetAwsS3ObjectDownloadUrl: (
    teamId: string,
    accountId: string,
    bucket: string,
    region: string,
    key: string,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:getAwsS3ObjectDownloadUrl',
      teamId,
      accountId,
      bucket,
      region,
      key,
      roleId,
    ),
}
