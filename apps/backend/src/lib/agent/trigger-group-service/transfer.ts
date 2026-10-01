import { AppError } from '@/lib/errors'

import { triggerExecutionPrincipalId } from '../trigger-access'
import { resolveTriggerGroupCredentialMode } from '../trigger-credential-access'
import { agentTriggers } from '../trigger-db'
import { agentTriggerGroups, isSharedIngressTriggerGroup } from '../trigger-group-db'
import { assertTransferTargetIsMember, executionPrincipalAssignment } from '../trigger-service'

import { getOwnedTriggerGroup } from './read'
import { loadPartitionTriggers, serializeTriggerGroup } from './shared'

import type { TriggerActorContext } from '../trigger-access'
import type { AgentTriggerGroup } from '../trigger-group-db'
import type { SerializedTriggerGroup } from './shared'

/**
 * Move a Watch Group's execution identity, and every ingress with it.
 *
 * The Group and its partitions must share one principal: a partial transfer
 * would leave the Group naming an identity its ingresses do not run as, and
 * the health check would report on two different people. Administrator-only,
 * for the same reason as the single-Trigger transfer — editing must never
 * promote a Group to its editor's permissions.
 */
export async function transferTriggerGroupExecutionPrincipal(
  groupId: string,
  context: TriggerActorContext,
  targetUserId: string,
): Promise<SerializedTriggerGroup> {
  const group = await getOwnedTriggerGroup(groupId, context, 'transfer')

  await assertTransferTargetIsMember(targetUserId, group.teamId)
  const assignment = executionPrincipalAssignment(targetUserId)
  const clearVerdict = {
    executionCredentialAccess: true,
    executionAuthorizationCheckedAt: true,
    executionAuthorizationError: true,
  } as const

  // Two collections cannot be written atomically here, so the Group document
  // is the single source of truth and is committed first. Propagation to the
  // ingresses is a cache fill: a partition that misses it is repaired from the
  // Group before it can execute (see trigger-executor.ts), so a partial
  // failure can never run a partition as the previous principal.
  const updated = await agentTriggerGroups().findOneAndUpdate(
    { _id: group._id, teamId: group.teamId },
    { $set: assignment, $unset: clearVerdict },
    { returnDocument: 'after' },
  )

  if (!isSharedIngressTriggerGroup(updated)) {
    throw new AppError(404, 'trigger_group_not_found', 'Watch Group not found')
  }
  await propagateTriggerGroupExecutionPrincipal(updated)

  return serializeTriggerGroup(updated, await loadPartitionTriggers(updated))
}

/**
 * Copy the Group's committed execution identity onto its ingresses.
 *
 * Idempotent and safe to re-run: the filter skips partitions that already
 * match, so a retry after a partial failure finishes the job without
 * disturbing partitions that are already correct.
 */
export async function propagateTriggerGroupExecutionPrincipal(
  group: AgentTriggerGroup,
): Promise<void> {
  const principalUserId = triggerExecutionPrincipalId(group)

  await agentTriggers().updateMany(
    {
      watchGroupId: group._id,
      cleanupStatus: { $exists: false },
      executionPrincipalUserId: { $ne: principalUserId },
    },
    {
      $set: {
        executionPrincipalUserId: principalUserId,
        credentialMode: resolveTriggerGroupCredentialMode(group),
        ...(group.executionCredentialAccess
          ? { executionCredentialAccess: group.executionCredentialAccess }
          : {}),
        executionAuthorizationStatus: 'unchecked',
        updatedAt: new Date(),
      },
      $unset: {
        ...(group.executionCredentialAccess ? {} : { executionCredentialAccess: true }),
        executionAuthorizationCheckedAt: true,
        executionAuthorizationError: true,
      },
      $inc: { configRevision: 1 },
    },
  )
}
