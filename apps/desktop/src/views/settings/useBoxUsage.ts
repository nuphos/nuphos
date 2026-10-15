import { useEffect, useState } from 'react'

import { api } from '../../api'

import type { BoxUsage } from '../../api/device-types'

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

  return { usage, reload: () => setRevision((value) => value + 1) }
}
