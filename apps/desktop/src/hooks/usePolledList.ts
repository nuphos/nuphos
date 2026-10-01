import { useEffect, useInsertionEffect, useRef, useState } from 'react'

import { reportFrontendError } from '../lib/frontendErrorReporter'

import { readSwrCache, writeSwrCache } from '../lib/swrCache'

import { useWorkspaceTab } from './useWorkspaceTab'

const FLASH_MS = 700

type Options<T> = {
  loader: () => Promise<T[]>
  rowKey: (row: T) => string
  // Bump to force an immediate refetch (e.g. user pressed the refresh button).
  // Also resets the diff baseline so we don't flash every cell as "changed".
  refreshKey?: number
  // String identifier of the "scope" being queried (e.g. namespace + cluster).
  // When it changes the diff baseline is reset so we don't flash every cell as
  // "changed" just because we navigated to a different scope.
  //
  // It also keys the stale-while-revalidate row cache, so it MUST uniquely
  // identify the data source — resource kind, kubeconfig context, and
  // namespace — or one cluster's rows would paint as another's. Callers that
  // omit it get no caching (every mount starts with a spinner).
  scopeKey?: string
}

type State<T> = {
  rows: T[]
  loading: boolean
  error: string | null
  changedCells: Set<string> // `${rowKey}:${columnKey}`
}

// Diff two row snapshots and return the set of (rowKey:fieldKey) tokens whose
// values differ. We compare by JSON-serialized field value so primitive arrays
// like `external_ips` and `ports` flag changes too.
function diffRows<T>(prev: Map<string, T>, next: T[], rowKey: (row: T) => string): Set<string> {
  if (prev.size === 0) return new Set()
  const out = new Set<string>()

  for (const row of next) {
    const k = rowKey(row)
    const old = prev.get(k)

    if (!old) {
      // newly added row — flash every column we know about
      for (const f of Object.keys(row as Record<string, unknown>)) {
        out.add(`${k}:${f}`)
      }
      continue
    }
    for (const f of Object.keys(row as Record<string, unknown>)) {
      const a = (row as Record<string, unknown>)[f]
      const b = (old as Record<string, unknown>)[f]

      if (a === b) continue
      if (typeof a === 'object' && typeof b === 'object') {
        if (JSON.stringify(a) === JSON.stringify(b)) continue
      }
      out.add(`${k}:${f}`)
    }
  }

  return out
}

export function usePolledList<T>({
  loader,
  rowKey,
  refreshKey = 0,
  scopeKey = '',
}: Options<T>): State<T> {
  // Background poll cadence and tab-active gating live in App.tsx via
  // WorkspaceTabContext — every bump of pollTick is one heartbeat. Standalone
  // callers (outside a WorkspaceTabContext provider) read the default 0 and
  // only fetch on mount / refreshKey / scopeKey changes.
  const { pollTick } = useWorkspaceTab()

  const cacheKey = scopeKey ? `poll:${scopeKey}` : null
  const cacheKeyRef = useRef(cacheKey)

  // Stale-while-revalidate: seed from the last rows this scope produced so a
  // remount paints instantly; the initial fetch below refreshes in place.
  const [initialCache] = useState(() => (cacheKey ? readSwrCache<T[]>(cacheKey) : undefined))
  const [rows, setRows] = useState<T[]>(initialCache ?? [])
  const [loading, setLoading] = useState(initialCache === undefined)
  const [error, setError] = useState<string | null>(null)
  const [changedCells, setChangedCells] = useState<Set<string>>(new Set())

  const prevByKey = useRef<Map<string, T>>(new Map())
  const flashTimer = useRef<number | null>(null)
  // We re-create the loader on every render in callers that close over scope;
  // hold the latest one in a ref so the fetch effect doesn't have to depend
  // on it (which would otherwise refetch on every render).
  const loaderRef = useRef(loader)
  const rowKeyRef = useRef(rowKey)

  // Commit-phase assignment: writing refs during render is unsafe under
  // concurrent rendering. Insertion effects run before this hook's own
  // effects, so both of them still observe the current render's values.
  useInsertionEffect(() => {
    cacheKeyRef.current = cacheKey
    loaderRef.current = loader
    rowKeyRef.current = rowKey
  })
  // Each initial-load effect increments `generation`. A fetch captures its
  // gen on entry and refuses to commit results when the current generation
  // has moved on — that's how we keep an in-flight request from spilling
  // stale rows into a newer scope after refreshKey/scopeKey changes.
  const generationRef = useRef(0)
  // Coalesce overlapping background polls within the same generation. Initial
  // loads bypass this guard so a refreshKey bump always issues a fresh
  // request, even while a slow poll is still resolving.
  const inFlightRef = useRef(false)

  async function fetchOnce(generation: number, initial: boolean, showLoading = initial) {
    if (generationRef.current !== generation) return
    if (!initial && inFlightRef.current) return
    // Capture the scope's collaborators at start. The refs are re-assigned on
    // commit, but `generationRef` only advances in the effect — so a
    // scope switch has a window where an in-flight fetch from the old scope
    // would pass the generation check yet read the *new* scope's refs,
    // writing cluster A's rows into cluster B's cache and table. Comparing
    // the captured cacheKey on commit closes that window.
    const loader = loaderRef.current
    const rowKeyFn = rowKeyRef.current
    const cacheKey = cacheKeyRef.current

    inFlightRef.current = true
    if (initial && showLoading) setLoading(true)
    try {
      const next = await loader()

      if (generationRef.current !== generation || cacheKeyRef.current !== cacheKey) return
      const diffs = diffRows(prevByKey.current, next, rowKeyFn)
      const map = new Map<string, T>()

      for (const r of next) map.set(rowKeyFn(r), r)
      prevByKey.current = map
      if (cacheKey) writeSwrCache(cacheKey, next)
      setRows(next)
      setError(null)
      if (diffs.size > 0) {
        setChangedCells((cur) => {
          const merged = new Set(cur)

          for (const d of diffs) merged.add(d)

          return merged
        })
        if (flashTimer.current) window.clearTimeout(flashTimer.current)
        flashTimer.current = window.setTimeout(() => {
          setChangedCells(new Set())
          flashTimer.current = null
        }, FLASH_MS)
      }
    } catch (e) {
      if (generationRef.current === generation && cacheKeyRef.current === cacheKey) {
        reportFrontendError(
          {
            source: 'polled_list',
            phase: 'load_failed',
            message: String(e instanceof Error ? e.message : e),
          },
          e,
        )
        setError(String(e instanceof Error ? e.message : e))
      }
    } finally {
      inFlightRef.current = false
      if (generationRef.current === generation && cacheKeyRef.current === cacheKey && initial) {
        setLoading(false)
      }
    }
  }

  // Initial load + reset when scope/refreshKey changes. The baseline reset
  // lives here so a poll tick doesn't blow away the diff cache and flash
  // every cell on the next snapshot.
  // Distinguishes a user-initiated refresh (refreshKey bump) from mounts and
  // scope switches: the former keeps showing cached rows but still reports
  // loading so the toolbar refresh icon spins as feedback.
  const lastRefreshKeyRef = useRef(refreshKey)

  useEffect(() => {
    const gen = ++generationRef.current
    const manualRefresh = refreshKey !== lastRefreshKeyRef.current

    lastRefreshKeyRef.current = refreshKey
    prevByKey.current = new Map()
    // Cache hit (including a mid-mount scope switch back to a visited scope):
    // paint the stale rows and skip the spinner while the fresh fetch runs.
    // The empty diff baseline above means the refresh won't flash every cell.
    const cached = cacheKeyRef.current ? readSwrCache<T[]>(cacheKeyRef.current) : undefined

    setRows(cached ?? [])
    if (cached && !manualRefresh) setLoading(false)
    setChangedCells(new Set())
    void fetchOnce(gen, true, cached === undefined || manualRefresh)

    return () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, scopeKey])

  // Each pollTick bump = one background heartbeat. Skip the very first tick
  // (the initial-load effect already issued that fetch) and any subsequent
  // tick that arrives while a fetch from the current generation is still
  // outstanding — `fetchOnce` enforces both rules.
  const firstTickRef = useRef(true)

  useEffect(() => {
    if (firstTickRef.current) {
      firstTickRef.current = false

      return
    }
    void fetchOnce(generationRef.current, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollTick])

  return { rows, loading, error, changedCells }
}
