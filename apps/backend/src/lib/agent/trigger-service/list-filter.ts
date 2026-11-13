import { liveTriggerShapeFilter } from '../trigger-db'

/**
 * A conversation's Triggers, or without one the caller's own. There is no
 * team-wide list: who may read a conversation's Triggers is checked against
 * the conversation before this filter runs.
 */
export function triggerListFilter(
  scope: { userId: string; teamId?: string },
  targetSessionId?: string,
) {
  if (!scope.teamId) {
    return {
      userId: scope.userId,
      teamId: { $exists: false },
      ...liveTriggerShapeFilter,
      ...(targetSessionId ? { targetSessionId } : {}),
    }
  }

  return {
    teamId: scope.teamId,
    ...(targetSessionId ? {} : { userId: scope.userId }),
    ...liveTriggerShapeFilter,
    ...(targetSessionId ? { targetSessionId } : {}),
  }
}
