import { AppError } from '@/lib/errors'

import type { RuntimeInstance } from './runtime-instances'
import type { RuntimeModelCatalog } from './runtime-models'

/** Distinct models that may wait for one runtime; more are refused, not queued. */
const MAX_WAITING_PER_RUNTIME = 4

/** Reads always reach the runtime, so a re-login or upgrade shows at once.
 *  Identical reads share one discovery, and a runtime runs one at a time. */
export function createRuntimeModelCatalog(deps: {
  requireInstance: (teamId: string, runtimeId: string, userId?: string) => Promise<RuntimeInstance>
  discover: (
    teamId: string,
    instance: RuntimeInstance,
    model?: string,
  ) => Promise<RuntimeModelCatalog>
}) {
  const joins = new Map<string, Promise<RuntimeModelCatalog>>()
  const runtimes = new Map<string, { tail: Promise<unknown>; size: number }>()

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
    const pending = joins.get(key)

    if (pending) return pending
    const runtimeKey = JSON.stringify([teamId, runtimeId])
    const queue = runtimes.get(runtimeKey) ?? { tail: Promise.resolve(), size: 0 }

    if (queue.size >= MAX_WAITING_PER_RUNTIME)
      throw new AppError(503, 'runtime_busy', 'Model discovery is busy. Retry shortly.')
    const result = queue.tail
      .then(() => deps.discover(teamId, instance, model))
      .catch(() => {
        throw new AppError(
          503,
          'runtime_models_unavailable',
          'Could not load models. Check the agent connection and retry.',
        )
      })
      .finally(() => {
        joins.delete(key)
        if (--queue.size === 0) runtimes.delete(runtimeKey)
      })

    queue.tail = result.catch(() => undefined)
    queue.size++
    runtimes.set(runtimeKey, queue)
    joins.set(key, result)

    return result
  }
}
