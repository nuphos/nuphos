import {
  aggregateWorkloadResources,
  getAppsApi,
  getBatchApi,
  getCoreApi,
  getMetricsClient,
  podMatchesSelector,
  podMetricsToUsageMap,
  withAuthRetry,
} from './k8s'
import { POLL_MS } from './k8s-metrics-shared'

import type { MetricsUpdate } from './k8s-metrics-shared'
import type * as k8s from '@kubernetes/client-node'

// Workload-level (Deployment / StatefulSet / DaemonSet / ReplicaSet / Job)
// metrics. Each poll fetches the workload list + pods + pod metrics, then
// aggregates per workload using the same selector logic as the
// `list*` functions in k8s.ts. Cache is keyed by (context, kind,
// namespace/name) — the watch system's mapRow reads from here when a row
// first arrives, and the poller's onUpdates patches subsequent changes.
export type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'ReplicaSet' | 'Job'

type WorkloadSubscriber = {
  scopeKey: string
  context: string
  namespace: string | null
  kind: WorkloadKind
  onUpdates: (updates: MetricsUpdate[]) => void
}

const workloadSubscribers = new Map<string, WorkloadSubscriber>()
const workloadTimers = new Map<string, NodeJS.Timeout>()

type WorkloadEntry = {
  cpu: number | null
  memory: number | null
  cpu_request: number | null
  memory_request: number | null
  cpu_limit: number | null
  memory_limit: number | null
}
const latestWorkloadResources = new Map<string, WorkloadEntry>()

function workloadKey(context: string, kind: WorkloadKind, rowKey: string): string {
  return `${context}\x1f${kind}\x1f${rowKey}`
}

function workloadEqual(a: WorkloadEntry | undefined, b: WorkloadEntry): boolean {
  if (!a) return false

  return (
    a.cpu === b.cpu &&
    a.memory === b.memory &&
    a.cpu_request === b.cpu_request &&
    a.memory_request === b.memory_request &&
    a.cpu_limit === b.cpu_limit &&
    a.memory_limit === b.memory_limit
  )
}

// Anything with a `spec.selector` we use to match pods. All workload kinds
// share this shape, so the poller's downstream logic stays uniform.
type AnyWorkload = {
  metadata?: { namespace?: string; name?: string }
  spec?: { selector?: k8s.V1LabelSelector }
}

async function fetchWorkloads(
  context: string,
  kind: WorkloadKind,
  namespace: string | null,
): Promise<AnyWorkload[]> {
  return withAuthRetry(context, async () => {
    if (kind === 'Deployment') {
      const api = getAppsApi(context)
      const r = namespace
        ? await api.listNamespacedDeployment({ namespace })
        : await api.listDeploymentForAllNamespaces()

      return r.items
    }
    if (kind === 'StatefulSet') {
      const api = getAppsApi(context)
      const r = namespace
        ? await api.listNamespacedStatefulSet({ namespace })
        : await api.listStatefulSetForAllNamespaces()

      return r.items
    }
    if (kind === 'DaemonSet') {
      const api = getAppsApi(context)
      const r = namespace
        ? await api.listNamespacedDaemonSet({ namespace })
        : await api.listDaemonSetForAllNamespaces()

      return r.items
    }
    if (kind === 'ReplicaSet') {
      const api = getAppsApi(context)
      const r = namespace
        ? await api.listNamespacedReplicaSet({ namespace })
        : await api.listReplicaSetForAllNamespaces()

      return r.items
    }
    // Job
    const api = getBatchApi(context)
    const r = namespace
      ? await api.listNamespacedJob({ namespace })
      : await api.listJobForAllNamespaces()

    return r.items
  })
}

async function pollWorkloadOnce(scopeKey: string) {
  const sub = workloadSubscribers.get(scopeKey)

  if (!sub) return
  const { context, namespace, kind } = sub
  const [workloads, podsRes, metricsRes] = await Promise.all([
    fetchWorkloads(context, kind, namespace).catch(() => null),
    withAuthRetry(context, async () => {
      const api = getCoreApi(context)

      return namespace ? api.listNamespacedPod({ namespace }) : api.listPodForAllNamespaces()
    }).catch(() => null),
    withAuthRetry(context, async () => {
      const metrics = getMetricsClient(context)

      return metrics.getPodMetrics(namespace ?? undefined)
    }).catch(() => null),
  ])

  if (!workloads || !podsRes) return
  const usageByKey = podMetricsToUsageMap(metricsRes)
  const updates: MetricsUpdate[] = []

  for (const wl of workloads) {
    const ns = wl.metadata?.namespace ?? ''
    const name = wl.metadata?.name ?? ''
    const matched = podsRes.items.filter(
      (p) => p.metadata?.namespace === ns && podMatchesSelector(p, wl.spec?.selector),
    )
    const aggregate = aggregateWorkloadResources(matched, usageByKey)
    const rowKey = `${ns}/${name}`
    const cacheKey = workloadKey(context, kind, rowKey)

    if (!workloadEqual(latestWorkloadResources.get(cacheKey), aggregate)) {
      latestWorkloadResources.set(cacheKey, aggregate)
      updates.push({
        rowKey,
        cpu: aggregate.cpu,
        memory: aggregate.memory,
        cpu_request: aggregate.cpu_request,
        memory_request: aggregate.memory_request,
        cpu_limit: aggregate.cpu_limit,
        memory_limit: aggregate.memory_limit,
      })
    }
  }
  if (updates.length > 0) sub.onUpdates(updates)
}

export function attachWorkloadMetricsSubscriber(
  context: string,
  kind: WorkloadKind,
  scopeKey: string,
  namespace: string | null,
  onUpdates: (updates: MetricsUpdate[]) => void,
) {
  workloadSubscribers.set(scopeKey, { scopeKey, context, namespace, kind, onUpdates })
  if (workloadTimers.has(scopeKey)) return
  void pollWorkloadOnce(scopeKey)
  const t = setInterval(() => void pollWorkloadOnce(scopeKey), POLL_MS)

  workloadTimers.set(scopeKey, t)
}

export function detachWorkloadMetricsSubscriber(scopeKey: string) {
  workloadSubscribers.delete(scopeKey)
  const t = workloadTimers.get(scopeKey)

  if (t) {
    clearInterval(t)
    workloadTimers.delete(scopeKey)
  }
}

export function getWorkloadResourcesFor(
  context: string,
  kind: WorkloadKind,
  rowKey: string,
): WorkloadEntry | null {
  return latestWorkloadResources.get(workloadKey(context, kind, rowKey)) ?? null
}

// No global "context change" reset needed anymore — metrics state is keyed by
// context, so a tab switching to a different cluster simply uses a different
// row in `latestUsage` / `subscribers`. Old metric pollers stay alive while
// their watch subscribers do.
