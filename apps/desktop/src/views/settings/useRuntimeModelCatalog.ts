import { useEffect, useState } from 'react'

import { api } from '../../api'

import type { RuntimeModelCatalog } from '../../types/runtime'

export function useRuntimeModelCatalog(
  teamId: string,
  runtimeId: string,
  canLoad: boolean,
  value?: string,
) {
  const [revision, setRevision] = useState(0)
  const requestKey = JSON.stringify([teamId, runtimeId, value, revision])
  const [result, setResult] = useState<{
    key: string
    catalog: RuntimeModelCatalog | null
    error: string | null
  } | null>(null)
  const current = result?.key === requestKey ? result : null
  const catalog = current?.catalog ?? null
  const loading = canLoad && !current
  const error = current?.error

  useEffect(() => {
    if (!canLoad) return
    let cancelled = false

    void Promise.resolve()
      .then(() => api.atlasGetRuntimeModels(teamId, runtimeId, value))
      .then(
        (nextCatalog) => {
          if (!cancelled)
            setResult({
              key: requestKey,
              catalog: nextCatalog,
              error:
                nextCatalog.message ?? (nextCatalog.models.length ? null : 'No models available.'),
            })
        },
        () => {
          if (!cancelled)
            setResult({
              key: requestKey,
              catalog: null,
              error: 'Could not load models. Try again.',
            })
        },
      )

    return () => {
      cancelled = true
    }
  }, [teamId, runtimeId, canLoad, requestKey, value])

  return {
    catalog,
    loading,
    error,
    retry: () => setRevision((previous) => previous + 1),
    models:
      catalog?.models ??
      (result?.key.startsWith(`${JSON.stringify([teamId, runtimeId]).slice(0, -1)},`)
        ? result.catalog?.models
        : undefined) ??
      [],
  }
}
