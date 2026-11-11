import type { AgentTrigger } from '../../api'

/**
 * Rows whose removal was seen failing just now: shown as Removing before and
 * as failed in this refresh. A failure that was already on screen is not new,
 * so it is reported once and then only shown by its "Cleanup needed" tag.
 */
export function newCleanupFailures(
  previous: readonly AgentTrigger[],
  next: readonly AgentTrigger[],
): AgentTrigger[] {
  const removing = new Set(
    previous.filter((trigger) => trigger.cleanupStatus === 'deleting').map((trigger) => trigger.id),
  )

  return next.filter(
    (trigger) => trigger.cleanupStatus === 'cleanup_failed' && removing.has(trigger.id),
  )
}

/** Cleanup failed only because the Watch's integration is no longer connected. */
export function integrationDisconnected(trigger: AgentTrigger | null): boolean {
  return (
    trigger?.cleanupStatus === 'cleanup_failed' &&
    trigger.cleanupErrorCode === 'provider_integration_disconnected'
  )
}
