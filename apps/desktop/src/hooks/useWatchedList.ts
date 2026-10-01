import { useEffect, useInsertionEffect, useRef, useState } from 'react'

import { api } from '../api'
import { toast } from '../components/ui/toast'
import { reportFrontendError } from '../lib/frontendErrorReporter'
import { readSwrCache, writeSwrCache } from '../lib/swrCache'

import { applyMetricsUpdates, diffFields, FLASH_MS, watchCacheKey } from './watchedListShared'

import type { K8sWatchEvent, K8sWatchKind, K8sWatchStreamState } from '../api'

type Options<T> = {
  /** The kubeconfig context to watch — typically read from per-tab state. */
  context: string
  kind: K8sWatchKind
  namespace: string | null
  rowKey: (row: T) => string
  /** When this changes, we tear the subscription down and start fresh. */
  scopeKey?: string
  /** Bump to force a re-subscribe (e.g. user clicked refresh). */
  refreshKey?: number
}

type State<T> = {
  rows: T[]
  loading: boolean
  error: string | null
  changedCells: Set<string>
  streamStatus: K8sWatchStreamState
}

export function useWatchedList<T>({
  context,
  kind,
  namespace,
  rowKey,
  scopeKey = '',
  refreshKey = 0,
}: Options<T>): State<T> {
  // Stale-while-revalidate: seed from the last rows this context/kind/scope
  // produced (this mount and every remount after the first) so navigation
  // back to a visited list paints instantly; the subscription below replaces
  // them with a fresh snapshot once it connects.
  const [initialCache] = useState(() => readSwrCache<T[]>(watchCacheKey(context, kind, namespace)))
  const [rows, setRows] = useState<T[]>(initialCache ?? [])
  const [loading, setLoading] = useState(initialCache === undefined)
  const [error, setError] = useState<string | null>(null)
  const [changedCells, setChangedCells] = useState<Set<string>>(new Set())
  const [streamStatus, setStreamStatus] = useState<K8sWatchStreamState>('connecting')

  const flashTimer = useRef<number | null>(null)
  const rowKeyRef = useRef(rowKey)

  useInsertionEffect(() => {
    rowKeyRef.current = rowKey
  })
  // Distinguishes a user-initiated refresh (refreshKey bump) from mounts and
  // scope switches: the former keeps showing cached rows but still reports
  // loading so the toolbar refresh icon spins as feedback.
  const lastRefreshKeyRef = useRef(refreshKey)

  // Reset the view state when the subscription scope (or a manual refresh)
  // changes. Adjusting state during render rather than from the subscribe
  // effect below means the previous scope's rows are never handed to the table
  // for a commit. On mount this is a no-op — the `useState` seeds above already
  // encode exactly the same cache hit / miss decision.
  const subscription = `${context}|${kind}|${namespace ?? ''}|${scopeKey}`
  const [lastSubscription, setLastSubscription] = useState({ subscription, refreshKey })

  if (
    lastSubscription.subscription !== subscription ||
    lastSubscription.refreshKey !== refreshKey
  ) {
    // Cache hit (including a mid-mount scope switch to a previously visited
    // scope): paint the stale rows now and skip the spinner; the fresh
    // snapshot replaces them. An empty cached array is still a hit — "known
    // empty" renders the empty state, not a spinner. A manual refresh keeps
    // the rows but reports loading so the refresh icon spins.
    const manualRefresh = lastSubscription.refreshKey !== refreshKey
    const cached = readSwrCache<T[]>(watchCacheKey(context, kind, namespace))

    setLastSubscription({ subscription, refreshKey })
    setRows(cached ?? [])
    setLoading(cached ? manualRefresh : true)
    setError(null)
    setStreamStatus('connecting')
  }

  useEffect(() => {
    let cancelled = false
    let activeSubscriptionId: string | null = null
    const byKey = new Map<string, T>()
    const cacheKey = watchCacheKey(context, kind, namespace)

    let commitTimer: number | null = null

    // Every committed row set also lands in the SWR cache so the next mount
    // of this context/kind/scope paints instantly.
    function flushCommit() {
      commitTimer = null
      const next = [...byKey.values()]

      writeSwrCache(cacheKey, next)
      setRows(next)
    }

    // Watch churn can deliver many change/metrics events back-to-back, and
    // each commit re-filters/re-sorts/re-renders the whole table — so bursts
    // are coalesced into one commit per frame. Snapshots flush immediately so
    // a fresh subscription never paints an intermediate empty state.
    function commitRows(immediate = false) {
      if (immediate) {
        if (commitTimer != null) window.clearTimeout(commitTimer)
        flushCommit()

        return
      }
      if (commitTimer != null) return
      commitTimer = window.setTimeout(flushCommit, 16)
    }

    function bumpFlash(adds: string[]) {
      if (adds.length === 0) return
      setChangedCells((cur) => {
        const merged = new Set(cur)

        for (const k of adds) merged.add(k)

        return merged
      })
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => {
        setChangedCells(new Set())
        flashTimer.current = null
      }, FLASH_MS)
    }

    function handleEvent(ev: K8sWatchEvent) {
      if (cancelled) return
      if (ev.subscriptionId !== activeSubscriptionId) return
      switch (ev.type) {
        case 'snapshot': {
          byKey.clear()
          for (const r of ev.rows as T[]) {
            byKey.set(rowKeyRef.current(r), r)
          }
          commitRows(true)
          setChangedCells(new Set())
          break
        }
        case 'change': {
          if (ev.change === 'deleted') {
            byKey.delete(ev.rowKey)
            commitRows()

            return
          }
          const next = ev.row as T | null

          if (!next) return
          const prev = byKey.get(ev.rowKey)

          byKey.set(ev.rowKey, next)
          commitRows()
          if (prev) {
            const fields = diffFields(prev, next)

            bumpFlash(fields.map((f) => `${ev.rowKey}:${f}`))
          } else {
            bumpFlash(Object.keys(next as Record<string, unknown>).map((f) => `${ev.rowKey}:${f}`))
          }
          break
        }
        case 'metrics': {
          if (applyMetricsUpdates(byKey, ev.updates)) commitRows()
          break
        }
        case 'status': {
          setStreamStatus(ev.state)
          if (ev.state === 'disconnected' && ev.error) {
            reportFrontendError({
              source: 'k8s_watch',
              phase: 'stream_disconnected',
              message: ev.error,
              kind,
            })
            setError(ev.error)
          }
          if (ev.state === 'live') setError(null)
          break
        }
      }
    }

    const offEvent = api.onK8sWatchEvent(handleEvent)
    const manualRefresh = refreshKey !== lastRefreshKeyRef.current

    lastRefreshKeyRef.current = refreshKey
    // A manual refresh re-syncs an already-live informer, which can finish in a
    // few ms — too fast for the spinner to be visible. Hold the spinner for a
    // floor so the button always reads as "did something".
    const MIN_SPIN_MS = 450
    const refreshStartedAt = Date.now()
    const finishManualRefresh = () => {
      const remaining = MIN_SPIN_MS - (Date.now() - refreshStartedAt)

      if (remaining > 0) {
        window.setTimeout(() => {
          if (!cancelled) setLoading(false)
        }, remaining)
      } else if (!cancelled) {
        setLoading(false)
      }
    }

    api
      .k8sWatchSubscribe(context, kind, namespace)
      .then((res) => {
        if (cancelled) {
          void api.k8sWatchUnsubscribe(res.subscriptionId)

          return
        }
        activeSubscriptionId = res.subscriptionId
        byKey.clear()
        for (const r of res.snapshot as T[]) {
          byKey.set(rowKeyRef.current(r), r)
        }
        commitRows(true)
        setStreamStatus(res.state)
        if (res.error) {
          reportFrontendError({
            source: 'k8s_watch',
            phase: 'subscribe_result_error',
            message: res.error,
            kind,
          })
          setError(res.error)
        }
        // The informer is shared and already live, so the snapshot above is
        // just its current cache — a manual refresh would otherwise be a no-op.
        // Force a fresh LIST so the Refresh button actually re-syncs; the new
        // snapshot arrives via the watch event handler. Keep the spinner up
        // until it resolves.
        if (manualRefresh) {
          api
            .k8sWatchRefresh(context, kind, namespace)
            .catch((e: unknown) => {
              // The live watch keeps the list current regardless, but a failed
              // user-triggered refresh shouldn't look successful — surface it.
              if (cancelled) return
              toast.apiError('Refresh failed', e)
            })
            .finally(finishManualRefresh)
        } else {
          setLoading(false)
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(String(e instanceof Error ? e.message : e))
        setStreamStatus('disconnected')
        setLoading(false)
      })

    return () => {
      cancelled = true
      offEvent()
      if (commitTimer != null) {
        window.clearTimeout(commitTimer)
        commitTimer = null
        // Persist the final coalesced rows so the SWR cache doesn't miss the
        // last burst when the user navigates away mid-stream. No setRows —
        // this scope is being torn down.
        writeSwrCache(cacheKey, [...byKey.values()])
      }
      if (flashTimer.current) {
        window.clearTimeout(flashTimer.current)
        flashTimer.current = null
      }
      if (activeSubscriptionId) {
        void api.k8sWatchUnsubscribe(activeSubscriptionId)
        activeSubscriptionId = null
      }
    }
  }, [context, kind, namespace, scopeKey, refreshKey])

  return { rows, loading, error, changedCells, streamStatus }
}
