import { useEffect, useInsertionEffect, useRef } from 'react'

import { reportFrontendError } from '../lib/frontendErrorReporter'

/**
 * Re-run `loader` silently every time `tick` actually changes value. Pair
 * with the view's existing initial-load `useEffect` to add background
 * polling without touching the loading-state flicker — when the loader
 * resolves, call `onResult`; on failure, call `onError` with the
 * stringified error.
 *
 * The hook always passes the rejection's `.message` verbatim (or the
 * `String()` cast for non-Error rejections) — callers relying on a literal
 * substring of `e.message` (e.g. the AtlasError sentinel) can safely
 * reconstruct the structured payload by passing the string through a
 * substring scan in their `onError` handler.
 *
 * The hook gates on the last seen `tick` rather than a "first render"
 * boolean so React 18 Strict Mode's mount → cleanup → mount replay doesn't
 * fire a spurious extra fetch (a `skipRef`-style flag would already be
 * `false` by the second effect run within the same value of `tick`).
 *
 * Overlapping ticks during a slow loader are coalesced via an in-flight
 * guard so a single stuck request never builds a queue of background
 * requests on top of itself.
 *
 * Typical use:
 *
 *   const { pollTick } = useWorkspaceTab();
 *   useSilentRefresh(loader, pollTick, setItems, setError);
 */
export function useSilentRefresh<T>(
  loader: () => Promise<T>,
  tick: number,
  onResult: (value: T) => void,
  onError: (message: string) => void,
  // Identifies the scope the loader reads from (e.g. the kubeconfig context).
  // When it changes, an in-flight refresh's result is dropped instead of
  // being committed through the *new* scope's onResult — without this, a
  // slow refresh of cluster A resolving after a switch to cluster B would
  // hand A's data to a callback that now stores it under B.
  scopeKey?: string,
): void {
  const loaderRef = useRef(loader)
  const onResultRef = useRef(onResult)
  const onErrorRef = useRef(onError)

  // Commit-phase assignment: refs must not be written during render. Insertion
  // effects land before the polling effect below, so it still sees the latest.
  useInsertionEffect(() => {
    loaderRef.current = loader
    onResultRef.current = onResult
    onErrorRef.current = onError
  })
  // Seeding with the current `tick` means the first effect run sees
  // lastTickRef === tick and skips — same effect on the Strict Mode replay
  // because the ref doesn't get updated unless we actually fired.
  const lastTickRef = useRef(tick)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (lastTickRef.current === tick) return
    if (inFlightRef.current) return
    lastTickRef.current = tick
    let cancelled = false

    inFlightRef.current = true
    loaderRef
      .current()
      .then(
        (res) => {
          if (!cancelled) onResultRef.current(res)
        },
        (e: unknown) => {
          if (!cancelled) {
            const message = String(e instanceof Error ? e.message : e)

            reportFrontendError({ source: 'silent_refresh', phase: 'refresh_failed', message }, e)
            onErrorRef.current(message)
          }
        },
      )
      .finally(() => {
        inFlightRef.current = false
      })

    return () => {
      cancelled = true
    }
  }, [tick, scopeKey])
}

/**
 * Call `fn` every time `tick` actually changes value. Use this variant when
 * the view already owns an imperative `load()`/`reload()` that mutates its
 * own state — we just need to re-trigger it on the heartbeat. The callsite
 * is responsible for in-flight de-dup; this hook only guarantees that the
 * same `tick` value never invokes `fn` twice (so Strict Mode's effect
 * replay is a no-op).
 */
export function useSilentTick(fn: () => void, tick: number): void {
  const fnRef = useRef(fn)

  useInsertionEffect(() => {
    fnRef.current = fn
  })
  const lastTickRef = useRef(tick)

  useEffect(() => {
    if (lastTickRef.current === tick) return
    lastTickRef.current = tick
    fnRef.current()
  }, [tick])
}
