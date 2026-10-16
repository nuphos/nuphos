import { useEffect, useState } from 'react'

import { api } from '../../api'

import type { BoxUsage } from '../../api/device-types'

/** Re-reads after Checkout or the portal opens: every 3 s for 2 minutes, since its webhook can be late. */
const WATCH_MS = 3_000
const WATCH_FOR_MS = 120_000

/** The team's Box plan and use. Refreshed when the window regains focus, as after paying in the browser. */
export function useBoxUsage(teamId: string) {
  const [usage, setUsage] = useState<BoxUsage | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false

    void api.boxUsage(teamId).then(
      (next) => {
        if (!cancelled) setUsage(next)
      },
      () => null,
    )

    return () => {
      cancelled = true
    }
  }, [teamId, revision])

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1)

    window.addEventListener('focus', refresh)

    return () => window.removeEventListener('focus', refresh)
  }, [])

  const [watchUntil, setWatchUntil] = useState(0)

  useEffect(() => {
    if (watchUntil === 0) return
    const timer = setInterval(() => {
      if (Date.now() < watchUntil) setRevision((value) => value + 1)
      else setWatchUntil(0)
    }, WATCH_MS)

    return () => clearInterval(timer)
  }, [watchUntil])

  return {
    usage,
    reload: () => setRevision((value) => value + 1),
    watch: () => setWatchUntil(Date.now() + WATCH_FOR_MS),
  }
}
