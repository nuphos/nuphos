import type {
  AwsEcsCluster,
  AwsEcsClusterMetricsResponse,
  AwsEcsContainerInstance,
  AwsEcsService,
  AwsEcsTask,
  AwsLambdaFunction,
  AwsLambdaFunctionDetail,
  AwsLambdaInvokeResult,
  AwsLambdaTriggers,
  AwsS3Bucket,
  AwsS3ObjectListing,
  AwsS3ObjectPreview,
} from '../types/aws-compute.ts'
import type {
  AwsCfnStack,
  AwsCloudWatchAlarm,
  AwsCloudWatchAlarmHistoryItem,
  AwsCloudWatchMetricData,
  AwsCloudWatchMetricListing,
  AwsCloudWatchMetricQuery,
  AwsLambdaMetricsResponse,
  AwsLogGroup,
  AwsLogGroupEvents,
  AwsLogSearchOptions,
  AwsLogSearchResult,
  AwsLogStreamListing,
} from '../types/aws-observability.ts'
import type { AwsEc2Instance, Firewall, Nacl, Vpc } from '../types/compute.ts'
import type {
  AwsIamPermissions,
  CloudflareIamInfo,
  GcpIamPermissions,
  PermissionGrantProposalView,
} from '../types/iam.ts'
import type { AtlasCluster } from '../types/provider-accounts.ts'

export type WindowAwsApi = {
  atlasListAwsVpcs(
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ): Promise<Vpc[]>
  atlasListAwsNacls(
    teamId: string,
    accountId: string,
    region?: string,
    vpcId?: string,
    roleId?: string,
  ): Promise<Nacl[]>
  atlasListAwsClusters(teamId: string, accountId: string, roleId?: string): Promise<AtlasCluster[]>
  atlasGetAwsIamPermissions(
    teamId: string,
    accountId: string,
    roleId?: string,
  ): Promise<AwsIamPermissions>
  atlasListPermissionGrantProposals(teamId: string): Promise<PermissionGrantProposalView[]>
  atlasGetPermissionGrantProposal(teamId: string, id: string): Promise<PermissionGrantProposalView>
  atlasApprovePermissionGrantProposal(
    teamId: string,
    id: string,
  ): Promise<PermissionGrantProposalView>
  atlasRejectPermissionGrantProposal(
    teamId: string,
    id: string,
  ): Promise<PermissionGrantProposalView>
  atlasGetGcpIamPermissions(
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ): Promise<GcpIamPermissions>
  atlasGetCloudflareIamPermissions(teamId: string, accountId: string): Promise<CloudflareIamInfo>
  atlasListGcpVpcs(teamId: string, projectId: string, serviceAccountId?: string): Promise<Vpc[]>
  atlasListGcpFirewalls(
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ): Promise<Firewall[]>
  atlasListGcpClusters(
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ): Promise<AtlasCluster[]>
  atlasListAwsEc2Instances(
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ): Promise<AwsEc2Instance[]>
  atlasListAwsEcsClusters(
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ): Promise<AwsEcsCluster[]>
  atlasListAwsEcsServices(
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    roleId?: string,
  ): Promise<AwsEcsService[]>
  atlasListAwsEcsTasks(
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    desiredStatus?: 'RUNNING' | 'STOPPED',
    roleId?: string,
  ): Promise<AwsEcsTask[]>
  atlasListAwsEcsContainerInstances(
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    roleId?: string,
  ): Promise<AwsEcsContainerInstance[]>
  atlasGetAwsEcsClusterMetrics(
    teamId: string,
    accountId: string,
    region: string,
    clusterName: string,
    rangeMinutes?: number,
    roleId?: string,
  ): Promise<AwsEcsClusterMetricsResponse>
  atlasListAwsCfnStacks(
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ): Promise<AwsCfnStack[]>
  atlasListAwsS3Buckets(teamId: string, accountId: string, roleId?: string): Promise<AwsS3Bucket[]>
  atlasListAwsS3BucketObjects(
    teamId: string,
    accountId: string,
    bucket: string,
    region: string,
    prefix: string,
    continuationToken: string | null,
    roleId?: string,
  ): Promise<AwsS3ObjectListing>
  atlasGetAwsS3ObjectDownloadUrl(
    teamId: string,
    accountId: string,
    bucket: string,
    region: string,
    key: string,
    roleId?: string,
  ): Promise<string>
  atlasGetAwsS3ObjectPreview(
    teamId: string,
    accountId: string,
    bucket: string,
    region: string,
    key: string,
    roleId?: string,
  ): Promise<AwsS3ObjectPreview>
  atlasListAwsLambdaFunctions(
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ): Promise<AwsLambdaFunction[]>
  atlasGetAwsLambdaFunctionDetail(
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ): Promise<AwsLambdaFunctionDetail>
  atlasGetAwsLambdaFunctionMetrics(
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    rangeMinutes?: number,
    roleId?: string,
  ): Promise<AwsLambdaMetricsResponse>
  atlasListAwsCloudWatchAlarms(
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ): Promise<AwsCloudWatchAlarm[]>
  atlasInvokeAwsLambdaFunction(
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    payload: string,
    roleId?: string,
  ): Promise<AwsLambdaInvokeResult>
  atlasUpdateAwsLambdaFunctionConfig(
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    updates: { memoryMb?: number; timeoutSec?: number; environment?: Record<string, string> },
    roleId?: string,
  ): Promise<void>
  atlasGetAwsLambdaTriggers(
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ): Promise<AwsLambdaTriggers>
  atlasSearchAwsLogGroupEvents(
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    options: AwsLogSearchOptions,
    roleId?: string,
  ): Promise<AwsLogSearchResult>
  atlasListAwsLogStreams(
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    nextToken?: string,
    roleId?: string,
  ): Promise<AwsLogStreamListing>
  atlasSetAwsLogGroupRetention(
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    retentionDays: number | null,
    roleId?: string,
  ): Promise<void>
  atlasListAwsCloudWatchMetrics(
    teamId: string,
    accountId: string,
    region: string,
    namespace?: string,
    metricName?: string,
    roleId?: string,
  ): Promise<AwsCloudWatchMetricListing>
  atlasGetAwsCloudWatchMetricData(
    teamId: string,
    accountId: string,
    region: string,
    query: AwsCloudWatchMetricQuery,
    roleId?: string,
  ): Promise<AwsCloudWatchMetricData>
  atlasGetAwsCloudWatchAlarmHistory(
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ): Promise<AwsCloudWatchAlarmHistoryItem[]>
  atlasListAwsLogGroups(
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ): Promise<AwsLogGroup[]>
  atlasGetAwsLogGroupEvents(
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ): Promise<AwsLogGroupEvents>
}
