import { appendQuery, call, withAwsRole } from './client'

export type AwsEc2Instance = {
  instanceId: string
  instanceType: string
  state: string
  region: string
  availabilityZone: string
  publicIp: string | null
  privateIp: string | null
  launchTime: string | null
  platform: string | null
  tags: Record<string, string>
}

export type AwsCfnStack = {
  stackId: string
  stackName: string
  status: string
  statusReason: string | null
  description: string | null
  createdAt: string
  updatedAt: string | null
  region: string
  driftStatus: string | null
}

export type AwsEcsCluster = {
  clusterArn: string
  clusterName: string
  status: string
  region: string
  registeredContainerInstancesCount: number
  runningTasksCount: number
  pendingTasksCount: number
  activeServicesCount: number
  capacityProviders: string[]
  tags: Record<string, string>
}

export async function listAwsEc2Instances(
  teamId: string,
  accountId: string,
  region?: string,
  roleId?: string,
): Promise<AwsEc2Instance[]> {
  const q = appendQuery('', { region, roleId })
  const data = await call<{ instances: AwsEc2Instance[] }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/ec2-instances${q}`,
  )

  return data.instances ?? []
}

export async function listAwsEcsClusters(
  teamId: string,
  accountId: string,
  region?: string,
  roleId?: string,
): Promise<AwsEcsCluster[]> {
  const q = appendQuery('', { region, roleId })
  const data = await call<{ clusters: AwsEcsCluster[] }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/ecs-clusters${q}`,
  )

  return data.clusters ?? []
}

export type AwsEcsService = {
  serviceArn: string
  serviceName: string
  status: string
  launchType: string | null
  taskDefinition: string
  desiredCount: number
  runningCount: number
  pendingCount: number
  schedulingStrategy: string | null
  createdAt: string | null
  platformVersion: string | null
}

export type AwsEcsTask = {
  taskArn: string
  taskId: string
  taskDefinitionArn: string
  taskDefinitionFamily: string
  taskDefinitionRevision: number
  lastStatus: string
  desiredStatus: string
  healthStatus: string | null
  launchType: string | null
  capacityProviderName: string | null
  cpu: string | null
  memory: string | null
  group: string | null
  availabilityZone: string | null
  containerInstanceArn: string | null
  startedAt: string | null
  stoppedAt: string | null
  stoppedReason: string | null
  createdAt: string | null
  connectivity: string | null
}

export type AwsEcsContainerInstance = {
  containerInstanceArn: string
  ec2InstanceId: string
  status: string
  agentConnected: boolean
  agentVersion: string | null
  dockerVersion: string | null
  runningTasksCount: number
  pendingTasksCount: number
  capacityProviderName: string | null
  registeredAt: string | null
  cpuRegistered: number | null
  cpuRemaining: number | null
  memoryRegistered: number | null
  memoryRemaining: number | null
}

export type AwsEcsMetricSeries = {
  metricName: string
  unit: string
  datapoints: { timestamp: string; average: number | null; maximum: number | null }[]
}

export type AwsEcsClusterMetricsResponse = {
  series: AwsEcsMetricSeries[]
  periodSec: number
  startTime: string
  endTime: string
}

function ecsClusterScopePath(
  teamId: string,
  accountId: string,
  region: string,
  clusterName: string,
): string {
  return `/teams/${teamId}/aws-accounts/${accountId}/ecs-clusters/${encodeURIComponent(region)}/${encodeURIComponent(clusterName)}`
}

export async function listAwsEcsServices(
  teamId: string,
  accountId: string,
  region: string,
  clusterName: string,
  roleId?: string,
): Promise<AwsEcsService[]> {
  const data = await call<{ services: AwsEcsService[] }>(
    'GET',
    withAwsRole(`${ecsClusterScopePath(teamId, accountId, region, clusterName)}/services`, roleId),
  )

  return data.services ?? []
}

export async function listAwsEcsTasks(
  teamId: string,
  accountId: string,
  region: string,
  clusterName: string,
  desiredStatus?: 'RUNNING' | 'STOPPED',
  roleId?: string,
): Promise<AwsEcsTask[]> {
  const q = appendQuery('', { desiredStatus, roleId })
  const data = await call<{ tasks: AwsEcsTask[] }>(
    'GET',
    `${ecsClusterScopePath(teamId, accountId, region, clusterName)}/tasks${q}`,
  )

  return data.tasks ?? []
}

export async function listAwsEcsContainerInstances(
  teamId: string,
  accountId: string,
  region: string,
  clusterName: string,
  roleId?: string,
): Promise<AwsEcsContainerInstance[]> {
  const data = await call<{ instances: AwsEcsContainerInstance[] }>(
    'GET',
    withAwsRole(
      `${ecsClusterScopePath(teamId, accountId, region, clusterName)}/container-instances`,
      roleId,
    ),
  )

  return data.instances ?? []
}

export async function getAwsEcsClusterMetrics(
  teamId: string,
  accountId: string,
  region: string,
  clusterName: string,
  rangeMinutes?: number,
  roleId?: string,
): Promise<AwsEcsClusterMetricsResponse> {
  const q = appendQuery('', { rangeMinutes, roleId })

  return call<AwsEcsClusterMetricsResponse>(
    'GET',
    `${ecsClusterScopePath(teamId, accountId, region, clusterName)}/metrics${q}`,
  )
}

export async function listAwsCfnStacks(
  teamId: string,
  accountId: string,
  region?: string,
  roleId?: string,
): Promise<AwsCfnStack[]> {
  const q = appendQuery('', { region, roleId })
  const data = await call<{ stacks: AwsCfnStack[] }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/cfn-stacks${q}`,
  )

  return data.stacks ?? []
}
