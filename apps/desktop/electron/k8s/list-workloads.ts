import { getClients, withAuthRetry } from './client'
import { podMetricsToUsageMap } from './rows-pods'
import {
  mapCronJobJobRow,
  mapCronJobRow,
  mapDaemonSetRow,
  mapJobRow,
  mapReplicaSetRow,
  mapStatefulSetRow,
} from './rows-sets'
import { aggregateWorkloadResources, podMatchesSelector } from './rows-workloads'
import { ageOf } from './utils'

import type { CronJobDetail } from './rows-sets'
import type * as k8s from '@kubernetes/client-node'

export function listReplicaSets(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { appsApi, coreApi, metricsClient: metrics } = getClients(context)
    const [res, podsRes, metricsRes] = await Promise.all([
      namespace
        ? appsApi.listNamespacedReplicaSet({ namespace })
        : appsApi.listReplicaSetForAllNamespaces(),
      namespace
        ? coreApi.listNamespacedPod({ namespace }).catch(() => null)
        : coreApi.listPodForAllNamespaces().catch(() => null),
      metrics.getPodMetrics(namespace ?? undefined).catch(() => null),
    ])
    const allPods = podsRes?.items ?? []
    const usageByKey = podMetricsToUsageMap(metricsRes)

    return res.items.map((r) => {
      const ns = r.metadata?.namespace ?? ''
      const matched = allPods.filter(
        (p) => p.metadata?.namespace === ns && podMatchesSelector(p, r.spec?.selector),
      )

      return mapReplicaSetRow(r, aggregateWorkloadResources(matched, usageByKey))
    })
  })
}

export function listStatefulSets(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { appsApi, coreApi, metricsClient: metrics } = getClients(context)
    const [res, podsRes, metricsRes] = await Promise.all([
      namespace
        ? appsApi.listNamespacedStatefulSet({ namespace })
        : appsApi.listStatefulSetForAllNamespaces(),
      namespace
        ? coreApi.listNamespacedPod({ namespace }).catch(() => null)
        : coreApi.listPodForAllNamespaces().catch(() => null),
      metrics.getPodMetrics(namespace ?? undefined).catch(() => null),
    ])
    const allPods = podsRes?.items ?? []
    const usageByKey = podMetricsToUsageMap(metricsRes)

    return res.items.map((s) => {
      const ns = s.metadata?.namespace ?? ''
      const matched = allPods.filter(
        (p) => p.metadata?.namespace === ns && podMatchesSelector(p, s.spec?.selector),
      )

      return mapStatefulSetRow(s, aggregateWorkloadResources(matched, usageByKey))
    })
  })
}

export function listDaemonSets(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { appsApi, coreApi, metricsClient: metrics } = getClients(context)
    const [res, podsRes, metricsRes] = await Promise.all([
      namespace
        ? appsApi.listNamespacedDaemonSet({ namespace })
        : appsApi.listDaemonSetForAllNamespaces(),
      namespace
        ? coreApi.listNamespacedPod({ namespace }).catch(() => null)
        : coreApi.listPodForAllNamespaces().catch(() => null),
      metrics.getPodMetrics(namespace ?? undefined).catch(() => null),
    ])
    const allPods = podsRes?.items ?? []
    const usageByKey = podMetricsToUsageMap(metricsRes)

    return res.items.map((d) => {
      const ns = d.metadata?.namespace ?? ''
      const matched = allPods.filter(
        (p) => p.metadata?.namespace === ns && podMatchesSelector(p, d.spec?.selector),
      )

      return mapDaemonSetRow(d, aggregateWorkloadResources(matched, usageByKey))
    })
  })
}

export function listJobs(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { batchApi, coreApi, metricsClient: metrics } = getClients(context)
    const [res, podsRes, metricsRes] = await Promise.all([
      namespace ? batchApi.listNamespacedJob({ namespace }) : batchApi.listJobForAllNamespaces(),
      namespace
        ? coreApi.listNamespacedPod({ namespace }).catch(() => null)
        : coreApi.listPodForAllNamespaces().catch(() => null),
      metrics.getPodMetrics(namespace ?? undefined).catch(() => null),
    ])
    const allPods = podsRes?.items ?? []
    const usageByKey = podMetricsToUsageMap(metricsRes)

    return res.items.map((j) => {
      const ns = j.metadata?.namespace ?? ''
      const matched = allPods.filter(
        (p) => p.metadata?.namespace === ns && podMatchesSelector(p, j.spec?.selector),
      )

      return mapJobRow(j, aggregateWorkloadResources(matched, usageByKey))
    })
  })
}

export function listCronJobs(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { batchApi } = getClients(context)
    const api = batchApi as unknown as {
      listNamespacedCronJob: (args: { namespace: string }) => Promise<{ items: k8s.V1CronJob[] }>
      listCronJobForAllNamespaces: () => Promise<{ items: k8s.V1CronJob[] }>
    }
    const res = namespace
      ? await api.listNamespacedCronJob({ namespace })
      : await api.listCronJobForAllNamespaces()

    return res.items.map(mapCronJobRow)
  })
}

// CronJob detail: the cron's basic parameters plus the Jobs it has spawned,
// newest first. Jobs are matched by ownerReference back to this CronJob (by
// UID when available, falling back to name) so manually-created Jobs that
// merely share a name prefix are excluded.
export function getCronJobDetail(
  context: string,
  namespace: string,
  name: string,
): Promise<CronJobDetail> {
  return withAuthRetry(context, async () => {
    const { batchApi } = getClients(context)
    const api = batchApi as unknown as {
      readNamespacedCronJob: (args: { name: string; namespace: string }) => Promise<k8s.V1CronJob>
    }
    // The CronJob read drives the whole detail, so let it reject. Listing
    // Jobs is best-effort: capture the failure into jobs_error so the UI can
    // distinguish "no Jobs yet" from "couldn't list Jobs" rather than letting
    // a missing `jobs` RBAC grant blank out the otherwise-readable CronJob.
    let jobsError: string | null = null
    const [cj, jobsRes] = await Promise.all([
      api.readNamespacedCronJob({ name, namespace }),
      batchApi.listNamespacedJob({ namespace }).catch((e: unknown) => {
        jobsError = String(e instanceof Error ? e.message : e)

        return { items: [] as k8s.V1Job[] }
      }),
    ])
    const uid = cj.metadata?.uid
    const owned = (jobsRes.items ?? []).filter((j) =>
      (j.metadata?.ownerReferences ?? []).some(
        (ref) => ref.kind === 'CronJob' && (uid ? ref.uid === uid : ref.name === name),
      ),
    )

    // Newest first by creation timestamp — the "recent runs" ordering users
    // expect from a CronJob's history.
    owned.sort((a, b) => {
      const at = a.metadata?.creationTimestamp
        ? new Date(a.metadata.creationTimestamp).getTime()
        : 0
      const bt = b.metadata?.creationTimestamp
        ? new Date(b.metadata.creationTimestamp).getTime()
        : 0

      return bt - at
    })

    return {
      namespace: cj.metadata?.namespace ?? '',
      name: cj.metadata?.name ?? '',
      age: ageOf(cj.metadata?.creationTimestamp),
      labels: Object.entries(cj.metadata?.labels ?? {}),
      annotations: Object.entries(cj.metadata?.annotations ?? {}),
      schedule: cj.spec?.schedule ?? '',
      time_zone: cj.spec?.timeZone ?? null,
      suspend: cj.spec?.suspend === true,
      concurrency_policy: cj.spec?.concurrencyPolicy ?? 'Allow',
      last_schedule: ageOf(cj.status?.lastScheduleTime),
      last_successful: ageOf(cj.status?.lastSuccessfulTime),
      active: cj.status?.active?.length ?? 0,
      successful_jobs_history_limit: cj.spec?.successfulJobsHistoryLimit ?? null,
      failed_jobs_history_limit: cj.spec?.failedJobsHistoryLimit ?? null,
      starting_deadline_seconds: cj.spec?.startingDeadlineSeconds ?? null,
      jobs: owned.map(mapCronJobJobRow),
      jobs_error: jobsError,
    }
  })
}
