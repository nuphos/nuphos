export type AwsLightsailPort = {
  fromPort: number | null
  toPort: number | null
  protocol: string
  accessType: string | null
  accessFrom: string | null
  cidrs: string[]
  ipv6Cidrs: string[]
}

export type AwsLightsailInstance = {
  name: string
  arn: string | null
  region: string
  availabilityZone: string | null
  state: string
  blueprintId: string | null
  blueprintName: string | null
  bundleId: string | null
  publicIp: string | null
  privateIp: string | null
  ipv6Addresses: string[]
  ipAddressType: string | null
  isStaticIp: boolean
  cpuCount: number | null
  ramSizeInGb: number | null
  username: string | null
  sshKeyName: string | null
  createdAt: string | null
  tags: Record<string, string>
  ports: AwsLightsailPort[]
}

export type SshSessionStart = {
  id: string
}

export type SshTerminalEvent =
  | { id: string; type: 'data'; data: string }
  | { id: string; type: 'exit'; code: number | null; signal: string | null }
  | { id: string; type: 'error'; message: string }

export type PodExecEvent =
  | { id: string; type: 'data'; data: string }
  | { id: string; type: 'exit'; code: number | null; reason: string | null }
  | { id: string; type: 'error'; message: string }

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

export type AwsS3Bucket = {
  name: string
  region: string
  createdAt: string | null
}

export type AwsS3Object = {
  key: string
  size: number
  lastModified: string | null
  storageClass: string | null
  etag: string | null
}

export type AwsS3ObjectListing = {
  prefix: string
  delimiter: string
  prefixes: string[]
  objects: AwsS3Object[]
  isTruncated: boolean
  nextContinuationToken: string | null
}

export type AwsS3ObjectPreview = {
  text: string
  truncated: boolean
  size: number
  contentType: string | null
}

export type AwsLambdaFunction = {
  name: string
  arn: string
  region: string
  runtime: string | null
  handler: string | null
  description: string | null
  memoryMb: number | null
  timeoutSec: number | null
  codeSizeBytes: number
  packageType: string | null
  architectures: string[]
  lastModified: string | null
}

export type AwsLambdaFunctionDetail = AwsLambdaFunction & {
  roleArn: string | null
  state: string | null
  stateReason: string | null
  lastUpdateStatus: string | null
  ephemeralStorageMb: number | null
  environment: Record<string, string>
  layers: string[]
  vpcSubnetIds: string[]
  vpcSecurityGroupIds: string[]
  logGroup: string
  codeSha256: string | null
  version: string | null
  reservedConcurrency: number | null
}

export type AwsLambdaMetricSeries = {
  metricName: string
  stat: 'Sum' | 'Average' | 'Maximum'
  unit: string
  datapoints: { timestamp: string; value: number | null; maximum: number | null }[]
}

export type AwsLambdaInvokeResult = {
  statusCode: number | null
  functionError: string | null
  executedVersion: string | null
  payload: string
  logTail: string
}

export type AwsLambdaEventSourceMapping = {
  uuid: string
  eventSourceArn: string | null
  state: string | null
  batchSize: number | null
  lastModified: string | null
}

export type AwsLambdaPolicyTrigger = {
  principal: string
  sourceArn: string | null
  statementId: string | null
}

export type AwsLambdaTriggers = {
  eventSourceMappings: AwsLambdaEventSourceMapping[]
  policyTriggers: AwsLambdaPolicyTrigger[]
}
