import { useEffect, useRef, useState } from 'react'

import { toast } from '../components/ui/toast'
import { useReportLoading } from '../components/useReportLoading'
import { reportFrontendError } from '../lib/frontendErrorReporter'
import { readCachedResourceList } from '../lib/resourceListCache'

import { useResetOnKey } from './useResetOnKey'

import type { ResourceListLoader } from '../lib/resourceListCache'

export function useResourceList<T>(
  loader: ResourceListLoader<T>,
  refreshKey: number,
  onLoading?: (loading: boolean) => void,
  options: { enabled?: boolean; pollTick?: number } = {},
) {
  const cacheKey = loader.cacheKey
  const enabled = options.enabled ?? true
  const pollTick = options.pollTick
  const [initialCache] = useState(() => readCachedResourceList<T>(cacheKey))
  const [items, setItems] = useState<T[]>(() => initialCache?.items ?? [])
  // A cached *empty* list must not suppress the skeleton: keep `loading` true so
  // we show a skeleton (not "No items") until the in-flight fetch confirms the
  // list is really empty. Only a cache with real rows renders instantly.
  const [loading, setLoading] = useState(
    () => enabled && !(initialCache && initialCache.items.length > 0),
  )
  // `revalidating` is the stale-while-revalidate signal: a background fetch is
  // in flight while we keep showing cached data (so `loading` stays false and
  // the table doesn't flash a skeleton). We surface it to the toolbar so the
  // top-right refresh button spins during the revalidation.
  const [revalidating, setRevalidating] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const itemsRef = useRef(items)
  const loaderRef = useRef(loader)
  const activeCacheKeyRef = useRef(cacheKey)
  const lastPollTickRef = useRef(options.pollTick ?? 0)
  const pollInFlightRef = useRef(false)

  // Keep the "latest" refs fresh from an effect rather than during render. This
  // effect is declared first, so it commits before the loader effects below read
  // the refs, and both refs are only ever read after the commit anyway.
  useEffect(() => {
    itemsRef.current = items
    loaderRef.current = loader
  })

  // Spin the toolbar refresh button for both a cold load and a background
  // revalidation, but only the cold `loading` drives the table skeleton.
  useReportLoading(loading || revalidating, onLoading)

  // Applied during render rather than from the fetch effect below, which runs
  // on exactly these three values: the effect version committed a frame of the
  // previous key's rows before swapping them out.
  useResetOnKey(`${String(cacheKey)}|${String(enabled)}|${String(refreshKey)}`, () => {
    if (!enabled) {
      setLoading(false)
      setRevalidating(false)

      return
    }
    const cached = readCachedResourceList<T>(cacheKey)

    if (cached && cached.items.length > 0) {
      setItems(cached.items)
      setLoading(false)
      setError(null)
    } else {
      // No cache, or a cached *empty* list — show the skeleton while the fetch
      // is in flight instead of flashing "No items" during the revalidate.
      setItems(cached?.items ?? [])
      setLoading(true)
      setError(null)
    }
    // A fetch is now in flight. For a cold load `loading` already covers the
    // spinner; for a cache hit this is the stale-while-revalidate refresh.
    setRevalidating(true)
  })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const cached = readCachedResourceList<T>(cacheKey)
    const sameCacheKey = activeCacheKeyRef.current === cacheKey

    activeCacheKeyRef.current = cacheKey

    loaderRef
      .current()
      .then((res) => {
        if (cancelled) return
        setItems(res)
        setError(null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const message = String(e instanceof Error ? e.message : e)

        reportFrontendError({ source: 'resource_list', phase: 'initial_load_failed', message }, e)
        // A cached *empty* list is no longer "usable" (we now keep loading until
        // a fetch confirms it), so on failure only fall back to cached rows when
        // there actually are some — otherwise surface the error.
        const hasUsableItems =
          (cached !== null && cached.items.length > 0) ||
          (sameCacheKey && itemsRef.current.length > 0)

        if (hasUsableItems) {
          // Keep showing the cached snapshot (persisted rows stay visible).
          // Real, non-transient failures (revoked/deleted role, …) come back
          // as structured backend errors and still toast through apiError;
          // transport blips while offline stay quiet by design — the cached
          // rows plus a later refresh cover that case.
          toast.apiError('Could not refresh — showing cached data', e)
          setLoading(false)
        } else {
          setError(message)
          setLoading(false)
        }
      })
      .finally(() => {
        if (cancelled) return
        setRevalidating(false)
      })

    return () => {
      cancelled = true
    }
  }, [cacheKey, enabled, refreshKey])

  useEffect(() => {
    if (!enabled || pollTick === undefined) return
    if (lastPollTickRef.current === pollTick) return
    if (pollInFlightRef.current) return
    lastPollTickRef.current = pollTick
    let cancelled = false

    pollInFlightRef.current = true
    loaderRef
      .current()
      .then((res) => {
        if (cancelled) return
        setItems(res)
        setError(null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const message = String(e instanceof Error ? e.message : e)

        reportFrontendError({ source: 'resource_list', phase: 'poll_failed', message }, e)

        if (itemsRef.current.length > 0) {
          // Polling is opportunistic; keep the stale rows visible and avoid
          // noisy global toasts for transient backend failures.
        } else {
          setError(message)
        }
      })
      .finally(() => {
        pollInFlightRef.current = false
      })

    return () => {
      cancelled = true
    }
  }, [enabled, pollTick])

  return { items, setItems, loading, revalidating, error, setError }
}
