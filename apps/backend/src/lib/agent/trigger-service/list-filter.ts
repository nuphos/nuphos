import { liveTriggerShapeFilter } from '../trigger-db'

export function triggerListFilter(
  scope: { userId: string; teamId?: string },
  targetSessionId?: string,
) {
  const ownership = scope.teamId
    ? { teamId: scope.teamId }
    : { userId: scope.userId, teamId: { $exists: false } }

  return {
    ...ownership,
    ...liveTriggerShapeFilter,
    ...(targetSessionId ? { targetSessionId } : {}),
  }
}
