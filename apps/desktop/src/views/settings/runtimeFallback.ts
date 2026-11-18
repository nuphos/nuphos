import type { RuntimeInstance } from '../../types/runtime'

/** A runtime's fallback can be any other runtime that is switched on. */
export function fallbackCandidates(
  instances: RuntimeInstance[],
  runtimeId: string,
): RuntimeInstance[] {
  return instances.filter((other) => other.id !== runtimeId && other.status === 'active')
}

/** Whoever manages a runtime edits it, except a local development agent or one being removed. */
export function editsRuntime(instance: RuntimeInstance, manages: boolean): boolean {
  return manages && instance.kind !== 'development' && !instance.deletion
}

/**
 * A turn its runtime could not run offers to set that runtime's fallback: only while it has
 * none (one that exists already moves the Task by itself), only to someone who may set it,
 * and only to someone who may also move this Task, since saving moves it.
 */
export function offersFallbackSetup({
  cause,
  runtime,
  edits,
  canMove,
  fallbacks,
}: {
  cause: string | undefined
  runtime: RuntimeInstance | undefined
  edits: boolean
  canMove: boolean
  fallbacks: Record<string, string> | undefined
}): boolean {
  return Boolean(cause && runtime && edits && canMove && fallbacks && !fallbacks[runtime.id])
}

/** Saves the team's fallback, then moves this Task; a save that fails moves nothing. */
export async function saveFallbackThenMove(
  save: () => Promise<unknown>,
  move: () => void,
): Promise<boolean> {
  try {
    await save()
  } catch {
    return false
  }
  move()

  return true
}
