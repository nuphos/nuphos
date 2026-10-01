import * as k8s from '@kubernetes/client-node'

import { getClients, withAuthRetry } from './client'

export type CronJobContainer = {
  name: string
  image: string
  command: string[]
  args: string[]
}

export type CronJobTriggerInfo = {
  namespace: string
  name: string
  schedule: string
  suspend: boolean
  containers: CronJobContainer[]
}

type CronJobBatchApi = {
  readNamespacedCronJob: (args: { name: string; namespace: string }) => Promise<k8s.V1CronJob>
  createNamespacedJob: (args: { namespace: string; body: k8s.V1Job }) => Promise<k8s.V1Job>
  patchNamespacedCronJob: (
    args: { name: string; namespace: string; body: unknown },
    opts: unknown,
  ) => Promise<unknown>
}

export function getCronJobTriggerInfo(
  context: string,
  namespace: string,
  name: string,
): Promise<CronJobTriggerInfo> {
  return withAuthRetry(context, async () => {
    const { batchApi } = getClients(context)
    const api = batchApi as unknown as CronJobBatchApi
    const cj = await api.readNamespacedCronJob({ name, namespace })
    const containers = cj.spec?.jobTemplate?.spec?.template?.spec?.containers ?? []

    return {
      namespace,
      name,
      schedule: cj.spec?.schedule ?? '',
      suspend: cj.spec?.suspend === true,
      containers: containers.map((c) => ({
        name: c.name,
        image: c.image ?? '',
        command: c.command ?? [],
        args: c.args ?? [],
      })),
    }
  })
}

/**
 * Create a one-off Job from a CronJob's job template, mirroring
 * `kubectl create job --from=cronjob/<name> <jobName>`.
 */
export function triggerCronJob(context: string, namespace: string, name: string, jobName: string) {
  return withAuthRetry(context, async () => {
    const { batchApi } = getClients(context)
    const api = batchApi as unknown as CronJobBatchApi
    const cj = await api.readNamespacedCronJob({ name, namespace })
    const jobTemplate = cj.spec?.jobTemplate

    if (!jobTemplate?.spec) {
      throw new Error(`CronJob "${name}" has no job template to trigger.`)
    }
    const body: k8s.V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace,
        annotations: {
          ...(jobTemplate.metadata?.annotations ?? {}),
          'cronjob.kubernetes.io/instantiate': 'manual',
        },
        ...(jobTemplate.metadata?.labels ? { labels: jobTemplate.metadata.labels } : {}),
        ownerReferences: [
          {
            apiVersion: 'batch/v1',
            kind: 'CronJob',
            name: cj.metadata?.name ?? name,
            uid: cj.metadata?.uid ?? '',
            controller: true,
            blockOwnerDeletion: true,
          },
        ],
      },
      spec: jobTemplate.spec,
    }
    const created = await api.createNamespacedJob({ namespace, body })

    return created.metadata?.name ?? jobName
  })
}

export function setCronJobSuspend(
  context: string,
  namespace: string,
  name: string,
  suspend: boolean,
) {
  return withAuthRetry(context, async () => {
    const { batchApi } = getClients(context)
    const api = batchApi as unknown as CronJobBatchApi

    await api.patchNamespacedCronJob(
      { name, namespace, body: { spec: { suspend } } },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    )
  })
}
