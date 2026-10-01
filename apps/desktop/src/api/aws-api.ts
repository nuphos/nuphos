import type { AwsCloudWatchMetricQuery, AwsLogSearchOptions } from '../types/aws-observability.ts'

export const awsApi = {
  atlasListAwsVpcs: (teamId: string, accountId: string, region?: string, roleId?: string) =>
    window.api.atlasListAwsVpcs(teamId, accountId, region, roleId),
  atlasListAwsNacls: (
    teamId: string,
    accountId: string,
    region?: string,
    vpcId?: string,
    roleId?: string,
  ) => window.api.atlasListAwsNacls(teamId, accountId, region, vpcId, roleId),
  atlasListAwsClusters: (teamId: string, accountId: string, roleId?: string) =>
    window.api.atlasListAwsClusters(teamId, accountId, roleId),
  atlasGetAwsIamPermissions: (teamId: string, accountId: string, roleId?: string) =>
    window.api.atlasGetAwsIamPermissions(teamId, accountId, roleId),
  atlasListPermissionGrantProposals: (teamId: string) =>
    window.api.atlasListPermissionGrantProposals(teamId),
  atlasGetPermissionGrantProposal: (teamId: string, id: string) =>
    window.api.atlasGetPermissionGrantProposal(teamId, id),
  atlasApprovePermissionGrantProposal: (teamId: string, id: string) =>
    window.api.atlasApprovePermissionGrantProposal(teamId, id),
  atlasRejectPermissionGrantProposal: (teamId: string, id: string) =>
    window.api.atlasRejectPermissionGrantProposal(teamId, id),
  atlasGetGcpIamPermissions: (teamId: string, projectId: string, serviceAccountId?: string) =>
    window.api.atlasGetGcpIamPermissions(teamId, projectId, serviceAccountId),
  atlasGetCloudflareIamPermissions: (teamId: string, accountId: string) =>
    window.api.atlasGetCloudflareIamPermissions(teamId, accountId),
  atlasListGcpVpcs: (teamId: string, projectId: string, serviceAccountId?: string) =>
    window.api.atlasListGcpVpcs(teamId, projectId, serviceAccountId),
  atlasListGcpFirewalls: (teamId: string, projectId: string, serviceAccountId?: string) =>
    window.api.atlasListGcpFirewalls(teamId, projectId, serviceAccountId),
  atlasListGcpClusters: (teamId: string, projectId: string, serviceAccountId?: string) =>
    window.api.atlasListGcpClusters(teamId, projectId, serviceAccountId),
  atlasListAwsEc2Instances: (teamId: string, accountId: string, region?: string, roleId?: string) =>
    window.api.atlasListAwsEc2Instances(teamId, accountId, region, roleId),
  atlasListAwsEcsClusters: (teamId: string, accountId: string, region?: string, roleId?: string) =>
    window.api.atlasListAwsEcsClusters(teamId, accountId, region, roleId),
  atlasListAwsEcsServices: (
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    roleId?: string,
  ) => window.api.atlasListAwsEcsServices(teamId, accountId, region, clusterName, roleId),
  atlasListAwsEcsTasks: (
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    desiredStatus?: 'RUNNING' | 'STOPPED',
    roleId?: string,
  ) =>
    window.api.atlasListAwsEcsTasks(teamId, accountId, region, clusterName, desiredStatus, roleId),
  atlasListAwsEcsContainerInstances: (
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    roleId?: string,
  ) => window.api.atlasListAwsEcsContainerInstances(teamId, accountId, region, clusterName, roleId),
  atlasGetAwsEcsClusterMetrics: (
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    rangeMinutes?: number,
    roleId?: string,
  ) =>
    window.api.atlasGetAwsEcsClusterMetrics(
      teamId,
      accountId,
      region,
      clusterName,
      rangeMinutes,
      roleId,
    ),
  atlasListAwsCfnStacks: (teamId: string, accountId: string, region?: string, roleId?: string) =>
    window.api.atlasListAwsCfnStacks(teamId, accountId, region, roleId),
  atlasListAwsS3Buckets: (teamId: string, accountId: string, roleId?: string) =>
    window.api.atlasListAwsS3Buckets(teamId, accountId, roleId),
  atlasListAwsS3BucketObjects: (
    teamId: string,
    accountId: string,
    bucket: string,
    region: string,
    prefix: string,
    continuationToken: string | null,
    roleId?: string,
  ) =>
    window.api.atlasListAwsS3BucketObjects(
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
  ) => window.api.atlasGetAwsS3ObjectDownloadUrl(teamId, accountId, bucket, region, key, roleId),
  atlasGetAwsS3ObjectPreview: (
    teamId: string,
    accountId: string,
    bucket: string,
    region: string,
    key: string,
    roleId?: string,
  ) => window.api.atlasGetAwsS3ObjectPreview(teamId, accountId, bucket, region, key, roleId),
  atlasListAwsLambdaFunctions: (
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ) => window.api.atlasListAwsLambdaFunctions(teamId, accountId, region, roleId),
  atlasGetAwsLambdaFunctionDetail: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ) => window.api.atlasGetAwsLambdaFunctionDetail(teamId, accountId, region, name, roleId),
  atlasGetAwsLambdaFunctionMetrics: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    rangeMinutes?: number,
    roleId?: string,
  ) =>
    window.api.atlasGetAwsLambdaFunctionMetrics(
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
  ) => window.api.atlasListAwsCloudWatchAlarms(teamId, accountId, region, roleId),
  atlasInvokeAwsLambdaFunction: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    payload: string,
    roleId?: string,
  ) => window.api.atlasInvokeAwsLambdaFunction(teamId, accountId, region, name, payload, roleId),
  atlasUpdateAwsLambdaFunctionConfig: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    updates: { memoryMb?: number; timeoutSec?: number; environment?: Record<string, string> },
    roleId?: string,
  ) =>
    window.api.atlasUpdateAwsLambdaFunctionConfig(teamId, accountId, region, name, updates, roleId),
  atlasGetAwsLambdaTriggers: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ) => window.api.atlasGetAwsLambdaTriggers(teamId, accountId, region, name, roleId),
  atlasSearchAwsLogGroupEvents: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    options: AwsLogSearchOptions,
    roleId?: string,
  ) => window.api.atlasSearchAwsLogGroupEvents(teamId, accountId, region, name, options, roleId),
  atlasListAwsLogStreams: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    nextToken?: string,
    roleId?: string,
  ) => window.api.atlasListAwsLogStreams(teamId, accountId, region, name, nextToken, roleId),
  atlasSetAwsLogGroupRetention: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    retentionDays: number | null,
    roleId?: string,
  ) =>
    window.api.atlasSetAwsLogGroupRetention(teamId, accountId, region, name, retentionDays, roleId),
  atlasListAwsCloudWatchMetrics: (
    teamId: string,
    accountId: string,
    region: string,
    namespace?: string,
    metricName?: string,
    roleId?: string,
  ) =>
    window.api.atlasListAwsCloudWatchMetrics(
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
    query: AwsCloudWatchMetricQuery,
    roleId?: string,
  ) => window.api.atlasGetAwsCloudWatchMetricData(teamId, accountId, region, query, roleId),
  atlasGetAwsCloudWatchAlarmHistory: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ) => window.api.atlasGetAwsCloudWatchAlarmHistory(teamId, accountId, region, name, roleId),
  atlasListAwsLogGroups: (teamId: string, accountId: string, region?: string, roleId?: string) =>
    window.api.atlasListAwsLogGroups(teamId, accountId, region, roleId),
  atlasGetAwsLogGroupEvents: (
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ) => window.api.atlasGetAwsLogGroupEvents(teamId, accountId, region, name, roleId),
}
