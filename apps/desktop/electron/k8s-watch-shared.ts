import type {
  ConfigMapRow,
  DaemonSetRow,
  DeploymentRow,
  EndpointSliceRow,
  EventRow,
  IngressRow,
  JobRow,
  NodeRow,
  PodRow,
  ReplicaSetRow,
  SecretRow,
  ServiceRow,
  StatefulSetRow,
  StorageClassRow,
} from './k8s'
import type { MetricsUpdate } from './k8s-metrics'
import type { WatchStreamState } from './k8s-watch-liveness'
import type * as k8s from '@kubernetes/client-node'
import type { WebContents } from 'electron'

export type WatchKind =
  | 'Pod'
  | 'Event'
  | 'Deployment'
  | 'Node'
  | 'Service'
  | 'ReplicaSet'
  | 'StatefulSet'
  | 'DaemonSet'
  | 'Job'
  | 'Ingress'
  | 'EndpointSlice'
  | 'ConfigMap'
  | 'Secret'
  | 'StorageClass'

export type WatchRow =
  | PodRow
  | EventRow
  | DeploymentRow
  | NodeRow
  | ServiceRow
  | ReplicaSetRow
  | StatefulSetRow
  | DaemonSetRow
  | JobRow
  | IngressRow
  | EndpointSliceRow
  | ConfigMapRow
  | SecretRow
  | StorageClassRow

export type WatchChangeKind = 'added' | 'modified' | 'deleted'

export type { WatchStreamState }

export type WatchEventPayload =
  | { subscriptionId: string; type: 'snapshot'; rows: WatchRow[] }
  | {
      subscriptionId: string
      type: 'change'
      change: WatchChangeKind
      rowKey: string
      row: WatchRow | null
    }
  | { subscriptionId: string; type: 'metrics'; updates: MetricsUpdate[] }
  | { subscriptionId: string; type: 'status'; state: WatchStreamState; error?: string }

export type Scope = { context: string; kind: WatchKind; namespace: string | null }

export type Subscription = {
  id: string
  scope: Scope
  scopeKey: string
  webContents: WebContents
  // True once we've delivered the initial snapshot via the invoke response.
  // We don't emit change events for the cache contents at that moment; subsequent
  // events stream normally.
  primed: boolean
}

export type FlushPending = {
  // rowKey → latest change for that key (last writer wins inside a flush window)
  changes: Map<string, { kind: WatchChangeKind; row: WatchRow | null }>
  timer: NodeJS.Timeout | null
}

export type InformerEntry = {
  scopeKey: string
  scope: Scope
  informer: k8s.Informer<k8s.KubernetesObject> & k8s.ObjectCache<k8s.KubernetesObject>
  /** Per-rowKey cached row (already mapped). New subscribers receive these as their snapshot. */
  cache: Map<string, WatchRow>
  state: WatchStreamState
  lastError?: string
  subscribers: Set<Subscription>
  startPromise: Promise<void> | null
  /** True for exactly as long as a (re)start owns the failure path — the abort
   * that stop() raises included. Unlike `startPromise` it clears synchronously
   * the moment start() settles, so an error arriving right after can't fall
   * between the two handlers. */
  starting: boolean
  /**
   * Error raised by the initial LIST while `starting` was set. `ListWatch.start()`
   * RESOLVES even when its list call throws — the failure is only dispatched to
   * the 'error' listener — so start() returning is not proof the cache was
   * filled. Without this, a failed LIST is indistinguishable from an empty
   * cluster: the entry gets marked live with an empty cache and the view shows
   * "no items" with no error at all.
   */
  startError?: unknown
  /** Set once a failure cycle has spent its one credential refresh; a 401
   * after that is terminal. Cleared by a successful start and by explicit
   * restarts (Refresh, stale resync, re-subscribe). */
  credentialRefreshAttempted: boolean
  /** Pending tear-down timer if subscriber count reached zero. */
  teardownTimer: NodeJS.Timeout | null
  flush: FlushPending
  reconnectAttempts: number
  /** False while the initial LIST is replaying into the cache; ADD events
   * during this window are absorbed silently so they don't duplicate the
   * snapshot the subscribe() call returns. Flips true after start() resolves. */
  initialReplayDone: boolean
  /** Last time the watch proved it was alive (an object event or a reconnect). */
  lastEventAt: number
  resyncTimer: NodeJS.Timeout | null
}

const COALESCE_MS = 80

export const TEARDOWN_GRACE_MS = 10_000
export const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 5000, 10_000]

export const informers = new Map<string, InformerEntry>()
export const subscriptions = new Map<string, Subscription>()

export function scopeKeyFor(scope: Scope): string {
  // Context is the first key segment so multiple Nuphos tabs viewing the same
  // (kind, namespace) on *different* clusters get isolated informer state.
  // Use the unit-separator (\x1f) between segments rather than ':' because
  // real-world context names contain ':' — EKS contexts look like
  // `arn:aws:eks:us-east-1:123:cluster/foo`, which would otherwise create
  // ambiguity when reused inside the key.
  return `${scope.context}\x1f${scope.kind}\x1f${scope.namespace ?? '*'}`
}

export function defaultKeyFromObject(obj: k8s.KubernetesObject): string {
  const ns = obj.metadata?.namespace ?? ''
  const name = obj.metadata?.name ?? ''

  return `${ns}/${name}`
}

export function safeSend(wc: WebContents, channel: string, payload: WatchEventPayload) {
  if (wc.isDestroyed()) return
  wc.send(channel, payload)
}

export function watchErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string' && err) return err
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const { message } = err

    if (typeof message === 'string' && message) return message
  }

  return 'watch error'
}

export function sendStatus(entry: InformerEntry, state: WatchStreamState, error?: string) {
  entry.state = state
  entry.lastError = error
  for (const sub of entry.subscribers) {
    if (!sub.primed) continue
    safeSend(sub.webContents, 'k8s:watch:event', {
      subscriptionId: sub.id,
      type: 'status',
      state,
      error,
    })
  }
}

export function enqueueChange(
  entry: InformerEntry,
  rowKey: string,
  kind: WatchChangeKind,
  row: WatchRow | null,
) {
  entry.flush.changes.set(rowKey, { kind, row })
  if (entry.flush.timer) return
  entry.flush.timer = setTimeout(() => flushChanges(entry), COALESCE_MS)
}

export function flushChanges(entry: InformerEntry) {
  entry.flush.timer = null
  if (entry.flush.changes.size === 0) return
  const items = [...entry.flush.changes.entries()]

  entry.flush.changes.clear()
  for (const sub of entry.subscribers) {
    if (!sub.primed) continue
    for (const [rowKey, { kind, row }] of items) {
      safeSend(sub.webContents, 'k8s:watch:event', {
        subscriptionId: sub.id,
        type: 'change',
        change: kind,
        rowKey,
        row,
      })
    }
  }
}

export type WatchRegistryEntry = {
  listPath: (ns: string | null) => string
  listFn: (context: string, ns: string | null) => k8s.ListPromise<k8s.KubernetesObject>
  mapRow: (obj: k8s.KubernetesObject, scope: Scope) => WatchRow
  keyOf: (obj: k8s.KubernetesObject) => string
  needsMetrics: boolean
}
