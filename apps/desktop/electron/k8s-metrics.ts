import { POLL_MS, shapeUsage } from './k8s-metrics-shared.ts'
import { getMetricsClient, podMetricsToUsageMap, withAuthRetry } from './k8s.ts'

import type { MetricsUpdate, Subscriber } from './k8s-metrics-shared.ts'

export * from './k8s-metrics-nodes.ts'
export * from './k8s-metrics-shared.ts'
export * from './k8s-metrics-workloads.ts'

type Usage = { cpu: number; memory: number }

// scopeKey → subscriber. `latest` holds the last poll's usage per row, so it
// lives and dies with the subscription and only ever lists pods that exist.
const subscribers = new Map<string, Subscriber & { readonly latest: Map<string, Usage> }>()
const timers = new Map<string, NodeJS.Timeout>() // scopeKey → poll timer

async function pollOnce(scopeKey: string) {
  const sub = subscribers.get(scopeKey)

  if (!sub) return
  let usageMap

  try {
    usageMap = await withAuthRetry(sub.context, async () => {
      const metrics = getMetricsClient(sub.context)
      const res = await metrics.getPodMetrics(sub.namespace ?? undefined)

      return podMetricsToUsageMap(res)
    })
  } catch {
    // Metrics-server is optional; swallow and try again next tick (matches the
    // current `.catch(() => null)` pattern in listPods).
    return
  }
  const updates: MetricsUpdate[] = []

  for (const [rowKey, raw] of usageMap) {
    const shaped = shapeUsage(raw.cpu, raw.memory)
    const prev = sub.latest.get(rowKey)

    if (prev?.cpu !== shaped.cpu || prev.memory !== shaped.memory) {
      sub.latest.set(rowKey, shaped)
      updates.push({ rowKey, cpu: shaped.cpu, memory: shaped.memory })
    }
  }
  // Pods the poll no longer reports are gone; keep only those that exist.
  for (const rowKey of sub.latest.keys()) if (!usageMap.has(rowKey)) sub.latest.delete(rowKey)
  if (updates.length > 0) sub.onUpdates(updates)
}

export function attachMetricsSubscriber(
  context: string,
  scopeKey: string,
  namespace: string | null,
  onUpdates: (updates: MetricsUpdate[]) => void,
) {
  // Only one subscriber per scope today; the watch manager handles fan-out to
  // multiple windows internally.
  subscribers.set(scopeKey, { scopeKey, context, namespace, onUpdates, latest: new Map() })
  if (timers.has(scopeKey)) return
  // Kick off an immediate poll so newly-mounted views see metrics fast.
  void pollOnce(scopeKey)
  const t = setInterval(() => void pollOnce(scopeKey), POLL_MS)

  timers.set(scopeKey, t)
}

export function detachMetricsSubscriber(scopeKey: string) {
  subscribers.delete(scopeKey)
  const t = timers.get(scopeKey)

  if (t) {
    clearInterval(t)
    timers.delete(scopeKey)
  }
}

export function getPodUsageFor(scopeKey: string, rowKey: string): Usage | null {
  return subscribers.get(scopeKey)?.latest.get(rowKey) ?? null
}
