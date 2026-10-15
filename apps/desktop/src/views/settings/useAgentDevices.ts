import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'

import { BOX_CREATING_POLL_MS } from './boxPresentation'

import type { AgentDeviceList } from '../../api'

const MAX_RETRY_MS = 30_000

/**
 * The signed-in user's devices. Loads on mount, on `reload` and when the window shows again;
 * polls again after the delay `poll` returns (0: not at all), never while the window is hidden, and backs off after
 * failures. A first load that fails (an older backend) is not retried. A new `key` starts over
 * from no list, so a caller never reads one taken before its change.
 */
export function useAgentDevices(
  poll: (list: AgentDeviceList) => number,
  key = '',
  { metrics = false, enabled = true }: { metrics?: boolean; enabled?: boolean } = {},
) {
  const [state, setState] = useState<{
    key: string
    list: AgentDeviceList | null
    error: boolean
  } | null>(null)
  const [revision, setRevision] = useState(0)
  const pollRef = useRef(poll)
  const inFlight = useRef<Promise<void> | null>(null)

  // The latest predicate, read by the timer below without restarting it.
  useEffect(() => {
    pollRef.current = poll
  })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let waiting = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let last: AgentDeviceList | null = null
    let failures = 0
    const schedule = (ms: number) => {
      if (!document.hidden) timer = setTimeout(load, ms)
    }
    const onError = () => {
      if (cancelled) return
      setState((current) => ({
        key,
        list: current?.key === key ? current.list : null,
        error: true,
      }))
      if (!last || pollRef.current(last) === 0) return
      failures += 1
      schedule(Math.min(BOX_CREATING_POLL_MS * 2 ** failures, MAX_RETRY_MS))
    }
    const onSuccess = (next: AgentDeviceList) => {
      if (cancelled) return
      last = next
      failures = 0
      setState({ key, list: next, error: false })
      const delay = pollRef.current(next)

      if (delay > 0) schedule(delay)
    }
    const resume = () => {
      waiting = false
      if (!cancelled) load()
    }
    const load = () => {
      clearTimeout(timer)
      if (cancelled || document.hidden) return
      // Reload / key changes cancel the old subscriber, not the underlying request.
      // Wait for it, then fetch fresh data for the current effect instead of reusing its result.
      if (inFlight.current) {
        if (!waiting) {
          waiting = true
          void inFlight.current.then(resume)
        }

        return
      }
      const request = api
        .boxListDevices({ metrics })
        .then(onSuccess, onError)
        .finally(() => {
          inFlight.current = null
        })

      inFlight.current = request
    }
    const onVisible = () => {
      clearTimeout(timer)
      if (!document.hidden) load()
    }

    load()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [revision, key, metrics, enabled])

  return {
    list: state?.key === key ? state.list : null,
    error: state?.key === key && state.error,
    reload: useCallback(() => setRevision((value) => value + 1), []),
  }
}

/** Whether this backend can make Boxes; false until it says so. */
export function useBoxAvailable(): boolean {
  return useAgentDevices(() => 0).list?.boxAvailable === true
}
