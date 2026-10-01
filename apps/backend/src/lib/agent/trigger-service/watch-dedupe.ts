import { isDeepStrictEqual } from 'node:util'

import { AppError } from '@/lib/errors'

import { agentTriggers } from '../trigger-db'

import type { MonitoringIdentity } from '../monitoring-workflow'
import type { AgentTrigger } from '../trigger-db'
import type { CreateTriggerInput, TriggerCallerContext } from './shared'

/**
 * Find the Watch this creation request should return instead of duplicating.
 *
 * Hash lookup alone cannot converge a team: the pre-team-ownership key is
 * derived from the creator, so a colleague cannot compute the key of a Watch
 * somebody else wired. Team Watches therefore also resolve by their stored
 * monitoring identity, which is creator-independent. Dotted fields keep the
 * match order-insensitive, unlike comparing the embedded document whole.
 *
 * Watches predating monitoringIdentity carry no identity to match on, so a
 * colleague can still only reach those through the creator's own hash.
 */
export async function findExistingWatch(input: {
  dedupeKey: string
  legacyDedupeKey: string | null
  teamId?: string
  monitoringIdentity?: MonitoringIdentity
}): Promise<AgentTrigger | null> {
  const byKey = await agentTriggers().findOne(
    input.legacyDedupeKey
      ? { dedupeKey: { $in: [input.dedupeKey, input.legacyDedupeKey] } }
      : { dedupeKey: input.dedupeKey },
  )

  if (byKey || !input.teamId || !input.monitoringIdentity) return byKey

  return agentTriggers().findOne({
    teamId: input.teamId,
    'monitoringIdentity.provider': input.monitoringIdentity.provider,
    'monitoringIdentity.integrationId': input.monitoringIdentity.integrationId,
    'monitoringIdentity.resourceId': input.monitoringIdentity.resourceId,
  })
}

export function assertDedupeCompatible(
  existing: AgentTrigger,
  input: CreateTriggerInput,
  ctx: TriggerCallerContext,
  /**
   * Every hash that this exact identity can legitimately produce: the current
   * team-scoped key plus, for a team Watch, the pre-team-ownership key. Both
   * are derived from the same identity, so matching either still proves it.
   */
  acceptedDedupeKeys: string[],
): void {
  if (existing.cleanupStatus) {
    throw new AppError(409, 'trigger_cleanup_pending', 'This Watch is being removed')
  }
  const sameOwner = ctx.teamId
    ? existing.teamId === ctx.teamId
    : existing.userId === ctx.userId && existing.teamId === undefined
  const sameType = existing.triggerType === input.triggerType
  const sameIncidentBoundary =
    existing.incidentMode === input.incidentMode &&
    isDeepStrictEqual(existing.slackDestination, input.slackDestination)
  // Rows created by the first monitoring-Watch implementation only persisted
  // the derived hash. Equality with the newly derived hash securely proves the
  // same identity and lets us backfill it below.
  const sameMonitoringIdentity =
    input.monitoringIdentity === undefined
      ? existing.monitoringIdentity === undefined
      : existing.monitoringIdentity === undefined
        ? Boolean(existing.dedupeKey) && acceptedDedupeKeys.includes(existing.dedupeKey!)
        : isDeepStrictEqual(existing.monitoringIdentity, input.monitoringIdentity)
  const sameGroupBoundary =
    existing.watchGroupId?.toString() === input.watchGroup?.groupId &&
    existing.watchGroupPartitionKey === input.watchGroup?.partitionKey

  if (
    !sameOwner ||
    !sameType ||
    !sameIncidentBoundary ||
    !sameMonitoringIdentity ||
    !sameGroupBoundary
  ) {
    throw new AppError(
      409,
      'trigger_dedupe_conflict',
      'That trigger idempotency key is already attached to a different workflow',
    )
  }
}

export async function backfillMonitoringIdentity(
  existing: AgentTrigger,
  identity: MonitoringIdentity | undefined,
): Promise<AgentTrigger> {
  if (!identity || existing.monitoringIdentity || !existing._id) return existing
  const result = await agentTriggers().updateOne(
    {
      _id: existing._id,
      cleanupStatus: { $exists: false },
      monitoringIdentity: { $exists: false },
    },
    { $set: { monitoringIdentity: identity } },
  )

  if (result.matchedCount === 0) {
    throw new AppError(409, 'trigger_changed', 'Trigger changed concurrently; reload it and retry')
  }

  return { ...existing, monitoringIdentity: identity }
}
