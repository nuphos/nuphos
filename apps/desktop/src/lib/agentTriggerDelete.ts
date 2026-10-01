import type { AgentTrigger } from '../api'

function isAgentTrigger(value: unknown): value is AgentTrigger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const trigger = value as Record<string, unknown>

  return (
    typeof trigger.id === 'string' &&
    trigger.id.length > 0 &&
    typeof trigger.userId === 'string' &&
    typeof trigger.name === 'string' &&
    (trigger.triggerType === 'cron' || trigger.triggerType === 'webhook') &&
    typeof trigger.messageTemplate === 'string' &&
    typeof trigger.enabled === 'boolean' &&
    typeof trigger.createdAt === 'string' &&
    typeof trigger.updatedAt === 'string' &&
    (trigger.cleanupStatus === undefined ||
      trigger.cleanupStatus === 'deleting' ||
      trigger.cleanupStatus === 'cleanup_failed')
  )
}

/**
 * Newer backends return the trigger while provider cleanup is pending. Older
 * backends return only `{ ok: true }` after deleting immediately, so keep this
 * compatibility check at the renderer boundary instead of assuming every
 * successful response has the new discriminated-union shape.
 */
export function pendingTriggerFromDeleteResult(result: unknown): AgentTrigger | null {
  if (!result || typeof result !== 'object') return null

  const candidate = result as { deleted?: unknown; trigger?: unknown }

  if (candidate.deleted !== false || !candidate.trigger || typeof candidate.trigger !== 'object') {
    return null
  }

  return isAgentTrigger(candidate.trigger) ? candidate.trigger : null
}

/**
 * Compatibility for older backends that returned 404 when an asynchronous
 * cleanup had already removed the Watch before the user's retry arrived.
 * Deleting an already-absent trigger has reached the requested final state.
 */
export function isTriggerAlreadyDeletedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  return (
    /(?:^|:\s)Trigger not found$/.test(error.message) ||
    /(?:^|:\s)HTTP 404(?:\b|$)/.test(error.message)
  )
}
