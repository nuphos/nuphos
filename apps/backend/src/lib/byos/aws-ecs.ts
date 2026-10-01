import {
  ECSClient,
  ListClustersCommand,
  DescribeClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
} from '@aws-sdk/client-ecs'

import { extractAwsAccountId } from './account'
import { assumeRoleAsConnector, getEnabledRegions } from './aws'
import { ecsClientFor } from './aws-ecs-shared'
import { collectAwsRegionalList } from './aws-errors'

export { listEcsTasks, listEcsContainerInstances } from './aws-ecs-tasks'
export { getEcsClusterMetrics } from './aws-ecs-metrics'

export type { AwsEcsTask, AwsEcsContainerInstance } from './aws-ecs-tasks'
export type { AwsEcsMetricSeries, AwsEcsClusterMetricsResponse } from './aws-ecs-metrics'

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

export async function listEcsClusters(
  roleArn: string,
  opts?: { region?: string },
): Promise<AwsEcsCluster[]> {
  const accountId = extractAwsAccountId(roleArn)

  if (!accountId) throw new Error('Invalid roleArn (cannot extract account ID)')
  const temp = await assumeRoleAsConnector(roleArn)
  const regions = await getEnabledRegions(accountId, temp)
  const target = opts?.region ? [opts.region] : regions

  return collectAwsRegionalList(target, 'ecs:ListClusters', async (region) => {
    const ecs = new ECSClient({ region, credentials: temp })

    const arns: string[] = []
    let nextToken: string | undefined

    do {
      const out = await ecs.send(new ListClustersCommand({ nextToken }))

      arns.push(...(out.clusterArns ?? []))
      nextToken = out.nextToken
    } while (nextToken)

    if (arns.length === 0) return []

    const clusters: AwsEcsCluster[] = []

    for (let i = 0; i < arns.length; i += 100) {
      const batch = arns.slice(i, i + 100)
      const out = await ecs.send(
        new DescribeClustersCommand({
          clusters: batch,
          include: ['TAGS'],
        }),
      )

      for (const c of out.clusters ?? []) {
        if (!c.clusterArn || !c.clusterName) continue
        clusters.push({
          clusterArn: c.clusterArn,
          clusterName: c.clusterName,
          status: c.status ?? 'UNKNOWN',
          region,
          registeredContainerInstancesCount: c.registeredContainerInstancesCount ?? 0,
          runningTasksCount: c.runningTasksCount ?? 0,
          pendingTasksCount: c.pendingTasksCount ?? 0,
          activeServicesCount: c.activeServicesCount ?? 0,
          capacityProviders: c.capacityProviders ?? [],
          tags: Object.fromEntries((c.tags ?? []).map((t) => [t.key ?? '', t.value ?? ''])),
        })
      }
    }

    return clusters
  })
}

export async function listEcsServices(
  roleArn: string,
  region: string,
  cluster: string,
): Promise<AwsEcsService[]> {
  const ecs = await ecsClientFor(roleArn, region)
  const arns: string[] = []
  let nextToken: string | undefined

  do {
    const out = await ecs.send(
      new ListServicesCommand({
        cluster,
        maxResults: 100,
        nextToken,
      }),
    )

    arns.push(...(out.serviceArns ?? []))
    nextToken = out.nextToken
  } while (nextToken)

  if (arns.length === 0) return []

  const services: AwsEcsService[] = []

  for (let i = 0; i < arns.length; i += 10) {
    const batch = arns.slice(i, i + 10)
    const out = await ecs.send(
      new DescribeServicesCommand({
        cluster,
        services: batch,
      }),
    )

    for (const s of out.services ?? []) {
      if (!s.serviceArn || !s.serviceName) continue
      services.push({
        serviceArn: s.serviceArn,
        serviceName: s.serviceName,
        status: s.status ?? 'UNKNOWN',
        launchType: s.launchType ?? null,
        taskDefinition: s.taskDefinition ?? '',
        desiredCount: s.desiredCount ?? 0,
        runningCount: s.runningCount ?? 0,
        pendingCount: s.pendingCount ?? 0,
        schedulingStrategy: s.schedulingStrategy ?? null,
        createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
        platformVersion: s.platformVersion ?? null,
      })
    }
  }

  return services
}
