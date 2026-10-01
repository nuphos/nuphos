import {
  aggregatePodCountsByNode,
  aggregatePodRequestsByNode,
  getCoreApi,
  getMetricsClient,
  nodeMetricsToUsageMap,
  withAuthRetry,
} from './k8s'
import { POLL_MS, shapeUsage, usageKey } from './k8s-metrics-shared'

import type { MetricsUpdate, Subscriber } from './k8s-metrics-shared'

// Node metrics live in a separate scope (cluster-wide, no namespace). Same
// shape and retention rules as the pod metrics poller above.
const nodeSubscribers = new Map<string, Subscriber>()
const nodeTimers = new Map<string, NodeJS.Timeout>()
const latestNodeUsage = new Map<string, { cpu: number; memory: number }>()
const latestNodeRequests = new Map<string, { cpu: number; memory: number }>()
const latestNodePodCounts = new Map<string, number>()

async function pollNodeOnce(scopeKey: string) {
  const sub = nodeSubscribers.get(scopeKey)

  if (!sub) return
  // Fetch usage (metrics-server) and per-node requested totals (pod specs) in
  // parallel. Either side may fail independently — metrics-server is
  // optional, and pod-list can be RBAC-gated — so we treat them separately
  // and emit whatever we have.
  const [usageMap, podSummary] = await Promise.all([
    withAuthRetry(sub.context, async () => {
      const metrics = getMetricsClient(sub.context)
      const res = await metrics.getNodeMetrics()

      return nodeMetricsToUsageMap(res)
    }).catch(() => null),
    withAuthRetry(sub.context, async () => {
      const coreApi = getCoreApi(sub.context)
      const pods = await coreApi.listPodForAllNamespaces()

      return {
        requests: aggregatePodRequestsByNode(pods),
        counts: aggregatePodCountsByNode(pods),
      }
    }).catch(() => null),
  ])

  if (!usageMap && !podSummary) return

  const touched = new Set<string>()

  if (usageMap) for (const n of usageMap.keys()) touched.add(n)
  if (podSummary) {
    for (const n of podSummary.requests.keys()) touched.add(n)
    for (const n of podSummary.counts.keys()) touched.add(n)
  }
  // Also revisit nodes we've cached before. If a node previously had
  // non-zero requested totals and now has none (e.g. every pod on it
  // was deleted), it'd drop out of `requestsMap` entirely — without
  // including the cached set the row would keep stale numbers forever.
  const prefix = `${sub.context}\x1f`

  if (podSummary) {
    for (const key of latestNodeRequests.keys()) {
      if (key.startsWith(prefix)) touched.add(key.slice(prefix.length))
    }
    for (const key of latestNodePodCounts.keys()) {
      if (key.startsWith(prefix)) touched.add(key.slice(prefix.length))
    }
  }

  const updates: MetricsUpdate[] = []

  for (const name of touched) {
    const key = usageKey(sub.context, name)
    let dirty = false
    const nextUsage = usageMap?.get(name)

    if (nextUsage) {
      const shaped = shapeUsage(nextUsage.cpu, nextUsage.memory)
      const prev = latestNodeUsage.get(key)

      if (prev?.cpu !== shaped.cpu || prev.memory !== shaped.memory) {
        latestNodeUsage.set(key, shaped)
        dirty = true
      }
    }
    const nextReq = podSummary?.requests.get(name) ?? null

    if (podSummary) {
      const shapedReq = nextReq ? shapeUsage(nextReq.cpu, nextReq.memory) : { cpu: 0, memory: 0 }
      const prev = latestNodeRequests.get(key)

      if (prev?.cpu !== shapedReq.cpu || prev.memory !== shapedReq.memory) {
        latestNodeRequests.set(key, shapedReq)
        dirty = true
      }
      const nextPodCount = podSummary.counts.get(name) ?? 0
      const prevPodCount = latestNodePodCounts.get(key)

      if (prevPodCount !== nextPodCount) {
        latestNodePodCounts.set(key, nextPodCount)
        dirty = true
      }
    }
    if (!dirty) continue
    const u = latestNodeUsage.get(key)
    const r = latestNodeRequests.get(key)
    const podCount = latestNodePodCounts.get(key)

    updates.push({
      // Nodes are cluster-scoped — rowKey for the watch entry is just `/name`
      // (defaultKeyFromObject builds `${ns}/${name}` with empty ns), so match
      // that here.
      rowKey: `/${name}`,
      cpu: u?.cpu ?? null,
      memory: u?.memory ?? null,
      cpu_request: r?.cpu ?? null,
      memory_request: r?.memory ?? null,
      pods: podCount ?? null,
    })
  }
  if (updates.length > 0) sub.onUpdates(updates)
}

export function attachNodeMetricsSubscriber(
  context: string,
  scopeKey: string,
  onUpdates: (updates: MetricsUpdate[]) => void,
) {
  nodeSubscribers.set(scopeKey, { scopeKey, context, namespace: null, onUpdates })
  if (nodeTimers.has(scopeKey)) return
  void pollNodeOnce(scopeKey)
  const t = setInterval(() => void pollNodeOnce(scopeKey), POLL_MS)

  nodeTimers.set(scopeKey, t)
}

export function detachNodeMetricsSubscriber(scopeKey: string) {
  nodeSubscribers.delete(scopeKey)
  const t = nodeTimers.get(scopeKey)

  if (t) {
    clearInterval(t)
    nodeTimers.delete(scopeKey)
  }
}

export function getNodeUsageFor(
  context: string,
  name: string,
): { cpu: number; memory: number } | null {
  return latestNodeUsage.get(usageKey(context, name)) ?? null
}

export function getNodeRequestsFor(
  context: string,
  name: string,
): { cpu: number; memory: number } | null {
  return latestNodeRequests.get(usageKey(context, name)) ?? null
}

export function getNodePodCountFor(context: string, name: string): number | null {
  return latestNodePodCounts.get(usageKey(context, name)) ?? null
}
