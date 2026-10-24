import { POLL_MS, shapeUsage } from './k8s-metrics-shared.ts'
import {
  aggregatePodCountsByNode,
  aggregatePodRequestsByNode,
  getCoreApi,
  getMetricsClient,
  nodeMetricsToUsageMap,
  withAuthRetry,
} from './k8s.ts'

import type { MetricsUpdate, Subscriber } from './k8s-metrics-shared.ts'

// Node metrics live in a separate scope (cluster-wide, no namespace). Same
// shape and retention rules as the pod metrics poller above: the latest values
// per node name belong to the subscription and go away with it.
type Usage = { cpu: number; memory: number }
type NodeSubscriber = Subscriber & {
  usage: Map<string, Usage>
  requests: Map<string, Usage>
  podCounts: Map<string, number>
}

const nodeSubscribers = new Map<string, NodeSubscriber>()
const nodeTimers = new Map<string, NodeJS.Timeout>()

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
  if (podSummary) {
    for (const name of sub.requests.keys()) touched.add(name)
    for (const name of sub.podCounts.keys()) touched.add(name)
  }

  const updates: MetricsUpdate[] = []

  for (const name of touched) {
    let dirty = false
    const nextUsage = usageMap?.get(name)

    if (nextUsage) {
      const shaped = shapeUsage(nextUsage.cpu, nextUsage.memory)
      const prev = sub.usage.get(name)

      if (prev?.cpu !== shaped.cpu || prev.memory !== shaped.memory) {
        sub.usage.set(name, shaped)
        dirty = true
      }
    }
    const nextReq = podSummary?.requests.get(name) ?? null

    if (podSummary) {
      const shapedReq = nextReq ? shapeUsage(nextReq.cpu, nextReq.memory) : { cpu: 0, memory: 0 }
      const prev = sub.requests.get(name)

      if (prev?.cpu !== shapedReq.cpu || prev.memory !== shapedReq.memory) {
        sub.requests.set(name, shapedReq)
        dirty = true
      }
      const nextPodCount = podSummary.counts.get(name) ?? 0
      const prevPodCount = sub.podCounts.get(name)

      if (prevPodCount !== nextPodCount) {
        sub.podCounts.set(name, nextPodCount)
        dirty = true
      }
    }
    if (!dirty) continue
    const u = sub.usage.get(name)
    const r = sub.requests.get(name)
    const podCount = sub.podCounts.get(name)

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
  nodeSubscribers.set(scopeKey, {
    scopeKey,
    context,
    namespace: null,
    onUpdates,
    usage: new Map(),
    requests: new Map(),
    podCounts: new Map(),
  })
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

export function getNodeUsageFor(scopeKey: string, name: string): Usage | null {
  return nodeSubscribers.get(scopeKey)?.usage.get(name) ?? null
}

export function getNodeRequestsFor(scopeKey: string, name: string): Usage | null {
  return nodeSubscribers.get(scopeKey)?.requests.get(name) ?? null
}

export function getNodePodCountFor(scopeKey: string, name: string): number | null {
  return nodeSubscribers.get(scopeKey)?.podCounts.get(name) ?? null
}
