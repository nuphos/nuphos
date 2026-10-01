import { ipcRenderer } from 'electron'

export const awsApi = {
  atlasGetAwsS3ObjectPreview: (
    teamId: string,
    accountId: string,
    bucket: string,
    region: string,
    key: string,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:getAwsS3ObjectPreview',
      teamId,
      accountId,
      bucket,
      region,
      key,
      roleId,
    ),
  atlasListAwsLambdaFunctions: (
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ) => ipcRenderer.invoke('atlas:listAwsLambdaFunctions', teamId, accountId, region, roleId),
  atlasGetAwsLambdaFunctionDetail: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ) =>
    ipcRenderer.invoke('atlas:getAwsLambdaFunctionDetail', teamId, accountId, region, name, roleId),
  atlasGetAwsLambdaFunctionMetrics: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    rangeMinutes?: number,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:getAwsLambdaFunctionMetrics',
      teamId,
      accountId,
      region,
      name,
      rangeMinutes,
      roleId,
    ),
  atlasListAwsCloudWatchAlarms: (
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ) => ipcRenderer.invoke('atlas:listAwsCloudWatchAlarms', teamId, accountId, region, roleId),
  atlasInvokeAwsLambdaFunction: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    payload: string,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:invokeAwsLambdaFunction',
      teamId,
      accountId,
      region,
      name,
      payload,
      roleId,
    ),
  atlasUpdateAwsLambdaFunctionConfig: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    updates: { memoryMb?: number; timeoutSec?: number; environment?: Record<string, string> },
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:updateAwsLambdaFunctionConfig',
      teamId,
      accountId,
      region,
      name,
      updates,
      roleId,
    ),
  atlasGetAwsLambdaTriggers: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ) => ipcRenderer.invoke('atlas:getAwsLambdaTriggers', teamId, accountId, region, name, roleId),
  atlasSearchAwsLogGroupEvents: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    options: {
      pattern?: string
      startTime?: number
      endTime?: number
      stream?: string
      nextToken?: string
    },
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:searchAwsLogGroupEvents',
      teamId,
      accountId,
      region,
      name,
      options,
      roleId,
    ),
  atlasListAwsLogStreams: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    nextToken?: string,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:listAwsLogStreams',
      teamId,
      accountId,
      region,
      name,
      nextToken,
      roleId,
    ),
  atlasSetAwsLogGroupRetention: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    retentionDays: number | null,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:setAwsLogGroupRetention',
      teamId,
      accountId,
      region,
      name,
      retentionDays,
      roleId,
    ),
  atlasListAwsCloudWatchMetrics: (
    teamId: string,
    accountId: string,
    region: string,
    namespace?: string,
    metricName?: string,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:listAwsCloudWatchMetrics',
      teamId,
      accountId,
      region,
      namespace,
      metricName,
      roleId,
    ),
  atlasGetAwsCloudWatchMetricData: (
    teamId: string,
    accountId: string,
    region: string,
    query: {
      namespace: string
      metricName: string
      dimensions: Record<string, string>
      stat: 'Average' | 'Sum' | 'Maximum' | 'Minimum'
      rangeMinutes?: number
    },
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:getAwsCloudWatchMetricData',
      teamId,
      accountId,
      region,
      query,
      roleId,
    ),
  atlasGetAwsCloudWatchAlarmHistory: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:getAwsCloudWatchAlarmHistory',
      teamId,
      accountId,
      region,
      name,
      roleId,
    ),
  atlasListAwsLogGroups: (teamId: string, accountId: string, region?: string, roleId?: string) =>
    ipcRenderer.invoke('atlas:listAwsLogGroups', teamId, accountId, region, roleId),
  atlasGetAwsLogGroupEvents: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ) => ipcRenderer.invoke('atlas:getAwsLogGroupEvents', teamId, accountId, region, name, roleId),
  atlasListAwsLightsailInstances: (
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ) => ipcRenderer.invoke('atlas:listAwsLightsailInstances', teamId, accountId, region, roleId),
  atlasRebootAwsLightsailInstance: (
    teamId: string,
    accountId: string,
    name: string,
    region: string,
    roleId?: string,
  ) =>
    ipcRenderer.invoke('atlas:rebootAwsLightsailInstance', teamId, accountId, name, region, roleId),
  atlasStartAwsLightsailSsh: (
    teamId: string,
    accountId: string,
    name: string,
    region: string,
    roleId?: string,
  ) => ipcRenderer.invoke('atlas:startAwsLightsailSsh', teamId, accountId, name, region, roleId),
}
