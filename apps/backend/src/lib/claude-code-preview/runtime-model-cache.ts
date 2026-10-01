import { AppError } from '@/lib/errors'

import type { RuntimeInstance } from './runtime-instances'
import type { RuntimeModelCatalog } from './runtime-models'

export function createRuntimeModelCatalog(deps: {
  requireInstance: (teamId: string, runtimeId: string, userId?: string) => Promise<RuntimeInstance>
  discover: (
    teamId: string,
    instance: RuntimeInstance,
    model?: string,
  ) => Promise<RuntimeModelCatalog>
  now: () => number
}) {
  const cache = new Map<string, { expires: number; result: Promise<RuntimeModelCatalog> }>()

  return async (
    teamId: string,
    runtimeId: string,
    model?: string,
    userId?: string,
  ): Promise<RuntimeModelCatalog> => {
    const instance = await deps.requireInstance(teamId, runtimeId, userId)

    if (instance.status !== 'active')
      throw new AppError(
        409,
        'runtime_unavailable',
        'Connect and enable this agent to load models.',
      )
    const key = JSON.stringify([teamId, runtimeId, model ?? null])
    const previous = cache.get(key)

    if (previous && previous.expires > deps.now()) return previous.result
    for (const [id, entry] of cache) if (entry.expires <= deps.now()) cache.delete(id)
    if (cache.size >= 100)
      throw new AppError(503, 'runtime_busy', 'Model discovery is busy. Retry shortly.')
    const entry = {
      expires: deps.now() + 60_000,
      result: Promise.resolve({ models: [] } as RuntimeModelCatalog),
    }

    entry.result = deps.discover(teamId, instance, model).then(
      (result) => {
        if (result.models.length && (!model || result.controls))
          entry.expires = deps.now() + 5 * 60_000
        else if (cache.get(key) === entry) cache.delete(key)

        return result
      },
      () => {
        if (cache.get(key) === entry) cache.delete(key)
        throw new AppError(
          503,
          'runtime_models_unavailable',
          'Could not load models. Check the agent connection and retry.',
        )
      },
    )
    cache.set(key, entry)

    return entry.result
  }
}
