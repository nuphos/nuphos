import { refreshContextCredentials, withAuthRetry } from './k8s'
import {
  resolveWatchFailure,
  shouldResyncStaleWatch,
  watchStartSucceeded,
} from './k8s-watch-liveness'
import {
  RECONNECT_BACKOFF_MS,
  informers,
  safeSend,
  sendStatus,
  watchErrorMessage,
} from './k8s-watch-shared'

import type { InformerEntry } from './k8s-watch-shared'

export function broadcastSnapshot(entry: InformerEntry) {
  const rows = [...entry.cache.values()]

  for (const sub of entry.subscribers) {
    if (!sub.primed) continue
    safeSend(sub.webContents, 'k8s:watch:event', {
      subscriptionId: sub.id,
      type: 'snapshot',
      rows,
    })
  }
}

export async function startInformer(entry: InformerEntry): Promise<void> {
  sendStatus(entry, 'connecting')
  const isReList = entry.subscribers.size > 0 // someone already had a snapshot

  entry.initialReplayDone = false
  entry.starting = true
  entry.startError = undefined
  try {
    await withAuthRetry(entry.scope.context, () => entry.informer.start())
    // start() resolving is not success: a throwing list call is reported only
    // through the 'error' listener, which parks it in `startError`.
    if (!watchStartSucceeded(entry.startError)) throw entry.startError
    entry.starting = false
    entry.credentialRefreshAttempted = false
    // The informer fired 'add' (and on re-LIST possibly 'delete') events for
    // each object during the initial list. We absorbed them into the cache
    // without emitting deltas. Future events are now real and should broadcast.
    entry.initialReplayDone = true
    entry.lastEventAt = Date.now()
    sendStatus(entry, 'live')
    // If subscribers were already attached before this start (i.e. this is a
    // reconnect after disconnect), push a fresh snapshot so they replace any
    // stale rows.
    if (isReList) broadcastSnapshot(entry)
  } catch (err) {
    entry.starting = false
    // The caller still holds startPromise, so the retry re-enters start()
    // directly rather than going through restartInformer's in-flight guard.
    await settleWatchFailure(entry, err, () => startInformer(entry))
  }
}

export async function settleWatchFailure(
  entry: InformerEntry,
  err: unknown,
  retry: () => Promise<void>,
): Promise<void> {
  const verdict = await resolveWatchFailure(err, entry, () =>
    refreshContextCredentials(entry.scope.context),
  )

  if (verdict === 'retry') {
    console.log(`[k8s-watch] restarting "${entry.scopeKey}" after credential refresh`)

    return retry()
  }
  sendStatus(entry, 'disconnected', watchErrorMessage(err))
  if (verdict === 'reconnect') scheduleReconnect(entry)
}

// Stop-then-start: start() re-LISTs from the API server, reconciles the cache
// and broadcasts a fresh snapshot to current subscribers via startInformer's
// isReList path. Concurrent callers (Refresh button, stale resync, a
// re-subscribe) all join the one in-flight restart instead of racing a second.
export function restartInformer(entry: InformerEntry): Promise<void> {
  entry.credentialRefreshAttempted = false

  return stopAndStart(entry)
}

export function stopAndStart(entry: InformerEntry): Promise<void> {
  if (entry.startPromise) return entry.startPromise
  // Claim the failure path before stop(): aborting the in-flight watch request
  // makes the informer emit an error, which is ours to swallow, not a real
  // disconnect to report and reconnect from.
  entry.starting = true
  // Assign startPromise *before* the first await so a concurrent caller sees
  // the in-flight restart and waits on it rather than slipping past the guard.
  const restart = (async () => {
    try {
      await entry.informer.stop()
    } catch {
      // ignore — start() below re-establishes the watch regardless
    }
    await startInformer(entry)
  })()
  const guarded = restart.finally(() => {
    if (entry.startPromise === guarded) entry.startPromise = null
  })

  entry.startPromise = guarded

  return guarded
}

export function resyncIfStale(entry: InformerEntry) {
  // The entry may have been torn down and replaced under the same scopeKey —
  // identity-compare so this timer can't restart a stopped informer.
  if (informers.get(entry.scopeKey) !== entry) return
  const stale = shouldResyncStaleWatch({
    hasSubscribers: entry.subscribers.size > 0,
    restarting: entry.startPromise !== null,
    state: entry.state,
    msSinceLastEvent: Date.now() - entry.lastEventAt,
  })

  if (!stale) return
  void restartInformer(entry).catch((e: unknown) =>
    console.error('[k8s-watch] stale resync failed:', e),
  )
}

export function scheduleReconnect(entry: InformerEntry) {
  // Nobody is watching, so don't burn retries in the background — the entry
  // stays in the map marked 'disconnected' and ensureInformer restarts it the
  // moment someone subscribes again.
  if (entry.subscribers.size === 0) return
  const idx = Math.min(entry.reconnectAttempts, RECONNECT_BACKOFF_MS.length - 1)
  const delay = RECONNECT_BACKOFF_MS[idx]

  entry.reconnectAttempts += 1
  setTimeout(() => {
    // The entry may have been torn down (e.g. on a kubeconfig context switch)
    // and possibly already replaced by a fresh entry under the same scopeKey
    // if the renderer re-subscribed quickly. Identity-compare so the old
    // closure doesn't resurrect a stopped informer alongside the new one.
    if (informers.get(entry.scopeKey) !== entry) return
    if (entry.subscribers.size === 0) return
    if (entry.state === 'live') return
    // A restart from another path (Refresh, re-subscribe) is already a fresh
    // sync — don't start a second informer alongside it.
    if (entry.startPromise) return
    void startInformer(entry)
  }, delay)
}
