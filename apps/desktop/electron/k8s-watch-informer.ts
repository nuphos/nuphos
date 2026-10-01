import * as k8s from '@kubernetes/client-node'

import {
  credentialExpiresAt,
  getKubeConfig,
  refreshContextCredentials,
  translateK8sError,
} from './k8s'
import { STALE_CHECK_MS, credentialRefreshDue, routeWatchError } from './k8s-watch-liveness'
import {
  restartInformer,
  resyncIfStale,
  settleWatchFailure,
  startInformer,
  stopAndStart,
} from './k8s-watch-reconnect'
import { REGISTRY } from './k8s-watch-registry'
import {
  TEARDOWN_GRACE_MS,
  enqueueChange,
  informers,
  scopeKeyFor,
  sendStatus,
} from './k8s-watch-shared'

import type { InformerEntry, Scope, WatchChangeKind, WatchRow } from './k8s-watch-shared'

export async function ensureInformer(scope: Scope): Promise<InformerEntry> {
  const scopeKey = scopeKeyFor(scope)
  let entry = informers.get(scopeKey)

  if (entry) {
    if (entry.teardownTimer) {
      clearTimeout(entry.teardownTimer)
      entry.teardownTimer = null
    }
    if (entry.startPromise) {
      await entry.startPromise
    }
    // The underlying ListWatch stops for good on a non-410 error, and
    // scheduleReconnect deliberately gives up while nobody is subscribed — so
    // an entry can sit dead in the map and hand every new subscriber a frozen
    // cache. Re-subscribing to anything that isn't live restarts it.
    if (entry.state !== 'live') {
      await restartInformer(entry)
    }

    return entry
  }
  entry = createInformerEntry(scope, scopeKey)
  informers.set(scopeKey, entry)
  entry.startPromise = startInformer(entry).finally(() => {
    if (entry) entry.startPromise = null
  })
  await entry.startPromise

  return entry
}

export function createInformerEntry(scope: Scope, scopeKey: string): InformerEntry {
  const config = REGISTRY[scope.kind]
  const kc = getKubeConfig(scope.context)
  const informer = k8s.makeInformer<k8s.KubernetesObject>(
    kc,
    config.listPath(scope.namespace),
    config.listFn(scope.context, scope.namespace),
  )
  const entry: InformerEntry = {
    scopeKey,
    scope,
    informer,
    cache: new Map(),
    state: 'connecting',
    subscribers: new Set(),
    startPromise: null,
    starting: false,
    teardownTimer: null,
    flush: { changes: new Map(), timer: null },
    reconnectAttempts: 0,
    credentialRefreshAttempted: false,
    initialReplayDone: false,
    lastEventAt: Date.now(),
    resyncTimer: null,
  }

  informer.on('add', (obj) => handleObject(entry, obj, 'added'))
  informer.on('update', (obj) => handleObject(entry, obj, 'modified'))
  informer.on('delete', (obj) => handleObject(entry, obj, 'deleted'))
  informer.on('connect', () => {
    entry.reconnectAttempts = 0
    entry.lastEventAt = Date.now()
    sendStatus(entry, 'live')
  })
  informer.on('error', (rawErr) => {
    // While startInformer is in flight it owns the failure path — let its catch
    // block do the status + reconnect work, otherwise a failing initial LIST
    // schedules two parallel reconnect timers and runs start() twice
    // concurrently. `starting` (not `startPromise`) is the ownership signal:
    // startPromise outlives start() by a few microtasks, and an error landing
    // in that gap would be dropped by both handlers, leaving a dead informer
    // reporting itself as live.
    //
    // The LIST rejects inside ListWatch, so it never passes through
    // withAuthRetry's translation — do it here or a blown deadline reaches the
    // user as "The user aborted a request".
    const err = translateK8sError(rawErr)

    if (routeWatchError(entry.starting) === 'park') {
      entry.startError = err

      return
    }
    void settleWatchFailure(entry, err, () => stopAndStart(entry))
  })
  entry.resyncTimer = setInterval(() => {
    if (credentialRefreshDue(credentialExpiresAt(scope.context), Date.now())) {
      void refreshContextCredentials(scope.context)
    }
    resyncIfStale(entry)
  }, STALE_CHECK_MS)

  return entry
}

export function handleObject(
  entry: InformerEntry,
  obj: k8s.KubernetesObject,
  kind: WatchChangeKind,
) {
  const config = REGISTRY[entry.scope.kind]
  const rowKey = config.keyOf(obj)

  entry.lastEventAt = Date.now()
  if (kind === 'deleted') {
    if (!entry.cache.has(rowKey)) return
    entry.cache.delete(rowKey)
    if (!entry.initialReplayDone) return
    enqueueChange(entry, rowKey, 'deleted', null)

    return
  }
  let row: WatchRow

  try {
    row = config.mapRow(obj, entry.scope)
  } catch (e) {
    console.error('[k8s-watch] mapRow failed:', e)

    return
  }
  const prev = entry.cache.get(rowKey)

  entry.cache.set(rowKey, row)
  if (!entry.initialReplayDone) return
  if (!prev) {
    enqueueChange(entry, rowKey, 'added', row)
  } else {
    enqueueChange(entry, rowKey, 'modified', row)
  }
}

export function scheduleTeardown(entry: InformerEntry) {
  if (entry.teardownTimer) clearTimeout(entry.teardownTimer)
  entry.teardownTimer = setTimeout(() => {
    // Mirror the scheduleReconnect identity guard: if a context switch tore
    // this entry down and a fresh entry has taken the slot, the old timer
    // must not run teardown on the captured entry — teardownInformer would
    // delete the new entry from the map by key.
    if (informers.get(entry.scopeKey) !== entry) return
    if (entry.subscribers.size > 0) return
    void teardownInformer(entry).catch((e: unknown) =>
      console.error('[k8s-watch] teardown error:', e),
    )
  }, TEARDOWN_GRACE_MS)
}

export async function teardownInformer(entry: InformerEntry) {
  // Only release the map slot if we still own it. Without this, a stale
  // teardown call (e.g. one that races a re-subscribe) would evict whatever
  // fresh entry currently lives at this scopeKey.
  if (informers.get(entry.scopeKey) === entry) {
    informers.delete(entry.scopeKey)
  }
  if (entry.flush.timer) {
    clearTimeout(entry.flush.timer)
    entry.flush.timer = null
  }
  if (entry.resyncTimer) {
    clearInterval(entry.resyncTimer)
    entry.resyncTimer = null
  }
  try {
    await entry.informer.stop()
  } catch (e) {
    console.warn('[k8s-watch] informer.stop() threw:', e)
  }
}
