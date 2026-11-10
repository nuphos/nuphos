import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

import { assertTriggerAccess, triggerExecutionPrincipalId } from '../trigger-access'
import { agentTriggers } from '../trigger-db'

import { findManagedTrigger, parseTriggerId, serializeTrigger } from './shared'

import type { TriggerActor } from '../trigger-access'
import type { AgentTrigger } from '../trigger-db'
import type { SerializedTrigger } from './shared'

/**
 * Move a Trigger's execution identity to another team member.
 *
 * This is the only way the identity changes, and it is Administrator-only:
 * editing a Trigger deliberately leaves it alone, so a Trigger can never be
 * promoted to its editor's permissions as a side effect of a content change.
 * Recovering a Watch whose creator left the team is the main reason to use it.
 *
 * The Trigger rebinds to the new principal's own credentials: carrying a
 * selection the departing principal made would bound the new principal by a
 * scope they never approved. Authorization is reset to unproven so the next
 * run re-verifies before anything executes.
 */
export async function transferTriggerExecutionPrincipal(
  triggerId: string,
  actor: TriggerActor,
  targetUserId: string,
): Promise<SerializedTrigger> {
  const _id = parseTriggerId(triggerId)
  const trigger = await findManagedTrigger(_id)

  await assertTriggerAccess(trigger, actor, 'transfer')
  if (!trigger.teamId) {
    throw new AppError(
      400,
      'trigger_team_required',
      'Only a team Trigger has an execution identity to transfer',
    )
  }
  if (trigger.cleanupStatus) {
    throw new AppError(409, 'trigger_cleanup_pending', 'This Watch is being removed')
  }
  // A Group's ingresses share one identity; transferring one in isolation
  // would leave the Group describing an identity its partitions do not use.
  if (trigger.watchGroupId) {
    throw new AppError(
      409,
      'trigger_group_ingress',
      'Transfer the Watch Group instead; its ingresses share one execution identity',
    )
  }
  await assertTransferTargetIsMember(targetUserId, trigger.teamId)

  const updated = await agentTriggers().findOneAndUpdate(
    { _id, cleanupStatus: { $exists: false } },
    {
      $set: executionPrincipalAssignment(targetUserId),
      $unset: {
        executionCredentialAccess: true,
        executionAuthorizationCheckedAt: true,
        executionAuthorizationError: true,
      },
      $inc: { configRevision: 1 },
    },
    { returnDocument: 'after' },
  )

  if (!updated) {
    throw new AppError(409, 'trigger_changed', 'Trigger changed concurrently; reload it and retry')
  }
  logEvent('info', 'agent.trigger.execution_principal_transferred', {
    trigger_id: triggerId,
    team_id: trigger.teamId,
    from_user_id: triggerExecutionPrincipalId(trigger),
    to_user_id: targetUserId,
  })

  return serializeTrigger(updated)
}

/**
 * The identity fields a transfer writes, shared by the Trigger and Group
 * paths. Callers pair it with an `$unset` of `executionCredentialAccess`.
 */
export function executionPrincipalAssignment(targetUserId: string): Partial<AgentTrigger> {
  return {
    executionPrincipalUserId: targetUserId,
    credentialMode: 'all',
    executionAuthorizationStatus: 'unchecked',
    updatedAt: new Date(),
  }
}

/** A Trigger may only run as someone who is currently on the team. */
export async function assertTransferTargetIsMember(
  targetUserId: string,
  teamId: string,
): Promise<void> {
  if (!targetUserId.trim()) {
    throw new AppError(400, 'invalid_request', 'userId is required')
  }
  const membership = await getTeamMembership(targetUserId, teamId)

  if (!membership) {
    throw new AppError(
      400,
      'invalid_execution_principal',
      'A Trigger can only run as a current member of its team',
    )
  }
}
