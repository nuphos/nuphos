import {
  ListTasksCommand,
  DescribeTasksCommand,
  ListContainerInstancesCommand,
  DescribeContainerInstancesCommand,
} from '@aws-sdk/client-ecs'

import { ecsClientFor } from './aws-ecs-shared'

import type { DesiredStatus } from '@aws-sdk/client-ecs'

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

function shortFromArn(arn: string): string {
  const slash = arn.lastIndexOf('/')

  return slash >= 0 ? arn.slice(slash + 1) : arn
}

function parseTaskDef(arn: string): { family: string; revision: number } {
  // arn:aws:ecs:region:acct:task-definition/family:revision
  const short = shortFromArn(arn)
  const colon = short.lastIndexOf(':')

  if (colon < 0) return { family: short, revision: 0 }
  const family = short.slice(0, colon)
  const revision = Number(short.slice(colon + 1)) || 0

  return { family, revision }
}

export async function listEcsTasks(
  roleArn: string,
  region: string,
  cluster: string,
  opts?: { desiredStatus?: 'RUNNING' | 'STOPPED' },
): Promise<AwsEcsTask[]> {
  const ecs = await ecsClientFor(roleArn, region)
  const desiredStatus: DesiredStatus | undefined = opts?.desiredStatus
  const arns: string[] = []
  let nextToken: string | undefined

  do {
    const out = await ecs.send(
      new ListTasksCommand({
        cluster,
        maxResults: 100,
        desiredStatus,
        nextToken,
      }),
    )

    arns.push(...(out.taskArns ?? []))
    nextToken = out.nextToken
  } while (nextToken)

  if (arns.length === 0) return []

  const tasks: AwsEcsTask[] = []

  for (let i = 0; i < arns.length; i += 100) {
    const batch = arns.slice(i, i + 100)
    const out = await ecs.send(
      new DescribeTasksCommand({
        cluster,
        tasks: batch,
      }),
    )

    for (const t of out.tasks ?? []) {
      if (!t.taskArn) continue
      const td = parseTaskDef(t.taskDefinitionArn ?? '')

      tasks.push({
        taskArn: t.taskArn,
        taskId: shortFromArn(t.taskArn),
        taskDefinitionArn: t.taskDefinitionArn ?? '',
        taskDefinitionFamily: td.family,
        taskDefinitionRevision: td.revision,
        lastStatus: t.lastStatus ?? 'UNKNOWN',
        desiredStatus: t.desiredStatus ?? 'UNKNOWN',
        healthStatus: t.healthStatus ?? null,
        launchType: t.launchType ?? null,
        capacityProviderName: t.capacityProviderName ?? null,
        cpu: t.cpu ?? null,
        memory: t.memory ?? null,
        group: t.group ?? null,
        availabilityZone: t.availabilityZone ?? null,
        containerInstanceArn: t.containerInstanceArn ?? null,
        startedAt: t.startedAt ? new Date(t.startedAt).toISOString() : null,
        stoppedAt: t.stoppedAt ? new Date(t.stoppedAt).toISOString() : null,
        stoppedReason: t.stoppedReason ?? null,
        createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : null,
        connectivity: t.connectivity ?? null,
      })
    }
  }

  return tasks
}

function readContainerInstanceResource(
  resources:
    | {
        name?: string
        integerValue?: number
        longValue?: number
        doubleValue?: number
        type?: string
      }[]
    | undefined,
  name: string,
): number | null {
  if (!resources) return null
  const r = resources.find((x) => x.name === name)

  if (!r) return null
  if (typeof r.integerValue === 'number') return r.integerValue
  if (typeof r.longValue === 'number') return r.longValue
  if (typeof r.doubleValue === 'number') return r.doubleValue

  return null
}

export async function listEcsContainerInstances(
  roleArn: string,
  region: string,
  cluster: string,
): Promise<AwsEcsContainerInstance[]> {
  const ecs = await ecsClientFor(roleArn, region)
  const arns: string[] = []
  let nextToken: string | undefined

  do {
    const out = await ecs.send(
      new ListContainerInstancesCommand({
        cluster,
        maxResults: 100,
        nextToken,
      }),
    )

    arns.push(...(out.containerInstanceArns ?? []))
    nextToken = out.nextToken
  } while (nextToken)

  if (arns.length === 0) return []

  const items: AwsEcsContainerInstance[] = []

  for (let i = 0; i < arns.length; i += 100) {
    const batch = arns.slice(i, i + 100)
    const out = await ecs.send(
      new DescribeContainerInstancesCommand({
        cluster,
        containerInstances: batch,
      }),
    )

    for (const ci of out.containerInstances ?? []) {
      if (!ci.containerInstanceArn) continue
      items.push({
        containerInstanceArn: ci.containerInstanceArn,
        ec2InstanceId: ci.ec2InstanceId ?? '',
        status: ci.status ?? 'UNKNOWN',
        agentConnected: ci.agentConnected ?? false,
        agentVersion: ci.versionInfo?.agentVersion ?? null,
        dockerVersion: ci.versionInfo?.dockerVersion ?? null,
        runningTasksCount: ci.runningTasksCount ?? 0,
        pendingTasksCount: ci.pendingTasksCount ?? 0,
        capacityProviderName: ci.capacityProviderName ?? null,
        registeredAt: ci.registeredAt ? new Date(ci.registeredAt).toISOString() : null,
        cpuRegistered: readContainerInstanceResource(ci.registeredResources, 'CPU'),
        cpuRemaining: readContainerInstanceResource(ci.remainingResources, 'CPU'),
        memoryRegistered: readContainerInstanceResource(ci.registeredResources, 'MEMORY'),
        memoryRemaining: readContainerInstanceResource(ci.remainingResources, 'MEMORY'),
      })
    }
  }

  return items
}
