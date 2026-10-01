import { useEffect, useState } from 'react'

import { reportFrontendError } from '../../lib/frontendErrorReporter'

import { useResetOnKey } from '../useResetOnKey'

export type CommonProps = {
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function applyFilter<T>(items: T[], filter: string, getText: (item: T) => string) {
  if (!filter) return items
  const f = filter.toLowerCase()

  return items.filter((x) => getText(x).toLowerCase().includes(f))
}

export function useLoader<T>(
  loader: () => Promise<T>,
  deps: readonly (string | number)[],
  initial: T,
) {
  const [items, setItems] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useResetOnKey(deps.join('|'), () => {
    setLoading(true)
    setError(null)
  })

  useEffect(() => {
    let cancelled = false

    loader()
      .then((res) => {
        if (cancelled) return
        setItems(res)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const message = String(e instanceof Error ? e.message : e)

        reportFrontendError({ source: 'ecs_loader', phase: 'load_failed', message }, e)
        setError(message)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { items, loading, error }
}
