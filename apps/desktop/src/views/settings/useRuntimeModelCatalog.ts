import { useEffect, useState } from 'react'

import { api } from '../../api'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { concreteModelChoices } from '../../lib/modelChoices'

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
  const sameModel =
    result &&
    JSON.parse(result.key)
      .slice(0, 3)
      .every((part: unknown, index: number) => part === [teamId, runtimeId, value ?? null][index])
  const catalog = current?.catalog ?? (sameModel ? result.catalog : null)
  const loading = canLoad && !current
  const error = current?.error

  useEffect(() => {
    if (!canLoad) return
    let cancelled = false

    void Promise.resolve()
      .then(() => api.atlasGetRuntimeModels(teamId, runtimeId, value))
      .then(
        (nextCatalog) => {
          const { choices, current } = concreteModelChoices(
            nextCatalog.models,
            nextCatalog.controls?.modelId,
          )

          nextCatalog = {
            ...nextCatalog,
            models: choices,
            ...(nextCatalog.controls
              ? { controls: { ...nextCatalog.controls, modelId: current ?? '' } }
              : {}),
          }

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

  // A sign-in can change the models an agent offers (OpenCode's do).
  useEffect(() => {
    const reload = () => setRevision((previous) => previous + 1)

    window.addEventListener(RUNTIME_INSTANCES_CHANGED, reload)

    return () => window.removeEventListener(RUNTIME_INSTANCES_CHANGED, reload)
  }, [])

  useEffect(() => {
    if (!canLoad || !catalog || catalog.models.length) return
    // A newly connected computer can report its models after its presence.
    const timer = setTimeout(() => setRevision((previous) => previous + 1), 5_000)

    return () => clearTimeout(timer)
  }, [canLoad, catalog])

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
