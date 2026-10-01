import { getMetricsClient, podMetricsToUsageMap, withAuthRetry } from './k8s'
import { POLL_MS, shapeUsage, usageKey } from './k8s-metrics-shared'

import type { MetricsUpdate, Subscriber } from './k8s-metrics-shared'

export * from './k8s-metrics-nodes'
export * from './k8s-metrics-shared'
export * from './k8s-metrics-workloads'

const subscribers = new Map<string, Subscriber>() // scopeKey → subscriber
const timers = new Map<string, NodeJS.Timeout>() // scopeKey → poll timer
// Latest known per-row metrics, keyed by `${context}\x1f${ns}/${name}` so a
// pod named `default/nginx` on cluster A doesn't collide with `default/nginx`
// on cluster B. The unit-separator avoids any ambiguity with context names
// that happen to contain colons or slashes.
const latestUsage = new Map<string, { cpu: number; memory: number }>()

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
    const key = usageKey(sub.context, rowKey)
    const prev = latestUsage.get(key)

    if (prev?.cpu !== shaped.cpu || prev.memory !== shaped.memory) {
      latestUsage.set(key, shaped)
      updates.push({ rowKey, cpu: shaped.cpu, memory: shaped.memory })
    }
  }
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
  subscribers.set(scopeKey, { scopeKey, context, namespace, onUpdates })
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

export function getPodUsageFor(
  context: string,
  rowKey: string,
): { cpu: number; memory: number } | null {
  return latestUsage.get(usageKey(context, rowKey)) ?? null
}
