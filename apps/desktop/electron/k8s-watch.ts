import { randomUUID } from 'node:crypto'

import {
  attachMetricsSubscriber,
  attachNodeMetricsSubscriber,
  attachWorkloadMetricsSubscriber,
  detachMetricsSubscriber,
  detachNodeMetricsSubscriber,
  detachWorkloadMetricsSubscriber,
} from './k8s-metrics'
import { ensureInformer, scheduleTeardown } from './k8s-watch-informer'
import { restartInformer } from './k8s-watch-reconnect'
import { REGISTRY } from './k8s-watch-registry'
import { informers, safeSend, scopeKeyFor, subscriptions } from './k8s-watch-shared'

import type { DeploymentRow, NodeRow, PodRow, StatefulSetRow } from './k8s'
import type { MetricsUpdate } from './k8s-metrics'
import type { WatchStreamState } from './k8s-watch-liveness'
import type { Scope, Subscription, WatchKind, WatchRow } from './k8s-watch-shared'
import type { WebContents } from 'electron'

export * from './k8s-watch-shared'

export async function subscribe(
  webContents: WebContents,
  context: string,
  kind: WatchKind,
  namespace: string | null,
): Promise<{
  subscriptionId: string
  snapshot: WatchRow[]
  state: WatchStreamState
  error?: string
}> {
  const scope: Scope = { context, kind, namespace }
  const entry = await ensureInformer(scope)
  const sub: Subscription = {
    id: randomUUID(),
    scope,
    scopeKey: entry.scopeKey,
    webContents,
    primed: true,
  }

  entry.subscribers.add(sub)
  subscriptions.set(sub.id, sub)
  if (entry.subscribers.size === 1 && REGISTRY[entry.scope.kind].needsMetrics) {
    const onUpdates = (updates: MetricsUpdate[]) => {
      // Patch cached rows in place so a future subscriber's snapshot reflects the
      // latest metrics, and notify any active subscribers without flashing.
      for (const u of updates) {
        const cached = entry.cache.get(u.rowKey) as
          (PodRow | NodeRow | DeploymentRow | StatefulSetRow) | undefined

        if (cached) {
          cached.cpu = u.cpu
          cached.memory = u.memory
          // Use loose-typed assignment for the optional fields. Each metrics
          // path leaves the fields it doesn't care about as `undefined` so
          // the guard below preserves the existing cached value.
          if (u.cpu_request !== undefined) {
            ;(cached as NodeRow).cpu_request = u.cpu_request
          }
          if (u.memory_request !== undefined) {
            ;(cached as NodeRow).memory_request = u.memory_request
          }
          if (u.cpu_limit !== undefined) {
            ;(cached as DeploymentRow).cpu_limit = u.cpu_limit
          }
          if (u.memory_limit !== undefined) {
            ;(cached as DeploymentRow).memory_limit = u.memory_limit
          }
        }
      }
      for (const s of entry.subscribers) {
        if (!s.primed) continue
        safeSend(s.webContents, 'k8s:watch:event', {
          subscriptionId: s.id,
          type: 'metrics',
          updates,
        })
      }
    }

    if (entry.scope.kind === 'Pod') {
      attachMetricsSubscriber(context, entry.scopeKey, namespace, onUpdates)
    } else if (entry.scope.kind === 'Node') {
      attachNodeMetricsSubscriber(context, entry.scopeKey, onUpdates)
    } else if (
      entry.scope.kind === 'Deployment' ||
      entry.scope.kind === 'StatefulSet' ||
      entry.scope.kind === 'DaemonSet' ||
      entry.scope.kind === 'ReplicaSet' ||
      entry.scope.kind === 'Job'
    ) {
      attachWorkloadMetricsSubscriber(
        context,
        entry.scope.kind,
        entry.scopeKey,
        namespace,
        onUpdates,
      )
    }
  }
  webContents.once('destroyed', () => {
    unsubscribe(sub.id)
  })
  const snapshot = [...entry.cache.values()]

  return { subscriptionId: sub.id, snapshot, state: entry.state, error: entry.lastError }
}

// Force a fresh LIST for a scope's shared informer. The watch is normally
// self-maintaining, so subscribe() just hands back the live cache — which makes
// the toolbar's Refresh button look dead.
export async function refresh(
  context: string,
  kind: WatchKind,
  namespace: string | null,
): Promise<void> {
  const entry = informers.get(scopeKeyFor({ context, kind, namespace }))

  if (!entry) return // nothing subscribed → nothing to refresh
  await restartInformer(entry)
}

export function unsubscribe(subscriptionId: string) {
  const sub = subscriptions.get(subscriptionId)

  if (!sub) return
  subscriptions.delete(subscriptionId)
  const entry = informers.get(sub.scopeKey)

  if (!entry) return
  entry.subscribers.delete(sub)
  if (entry.subscribers.size === 0) {
    if (entry.scope.kind === 'Pod') {
      detachMetricsSubscriber(entry.scopeKey)
    } else if (entry.scope.kind === 'Node') {
      detachNodeMetricsSubscriber(entry.scopeKey)
    } else if (
      entry.scope.kind === 'Deployment' ||
      entry.scope.kind === 'StatefulSet' ||
      entry.scope.kind === 'DaemonSet' ||
      entry.scope.kind === 'ReplicaSet' ||
      entry.scope.kind === 'Job'
    ) {
      detachWorkloadMetricsSubscriber(entry.scopeKey)
    }
    scheduleTeardown(entry)
  }
}

// No global "context change" tear-down needed anymore: every informer is
// keyed by its kubeconfig context, so switching one tab to a different
// cluster simply causes that tab to subscribe under a different scopeKey.
// Old subscribers stay attached to their cluster's informer, which is exactly
// what multi-tab parallel viewing requires.
