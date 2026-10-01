import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { resolveTriggerCredentialAccess } from '@/routes/agent'

import {
  executionAuthorizationIsCurrent,
  triggerExecutionPrincipalFilter,
  triggerExecutionPrincipalId,
  triggerGroupExecutionIsHealthy,
} from './trigger-access'
import {
  resolveTriggerGroupCredentialMode,
  triggerRunCredentialAccess,
} from './trigger-credential-access'
import { agentTriggers } from './trigger-db'
import { agentTriggerGroups } from './trigger-group-db'

import type { AgentTrigger } from './trigger-db'

/**
 * Pause exactly the ingresses whose execution identity broke. Watch Group
 * partitions may be rebound to different principals by later edits, so a
 * departed principal must not take working siblings down with it. The Group
 * itself is only paused once nothing is left to run.
 */
async function pauseIngressesForDepartedPrincipal(
  trigger: AgentTrigger,
  principalUserId: string,
  error: string,
  now: Date,
): Promise<void> {
  await agentTriggers().updateMany(
    {
      ...(trigger.watchGroupId ? { watchGroupId: trigger.watchGroupId } : { _id: trigger._id! }),
      ...triggerExecutionPrincipalFilter(principalUserId),
    },
    {
      $set: {
        enabled: false,
        executionAuthorizationStatus: 'invalid',
        executionAuthorizationCheckedAt: now,
        executionAuthorizationError: error,
        updatedAt: now,
      },
      $inc: { configRevision: 1 },
    },
  )

  if (!trigger.watchGroupId) return
  const stillEnabled = await agentTriggers().countDocuments({
    watchGroupId: trigger.watchGroupId,
    enabled: true,
  })

  await agentTriggerGroups().updateOne(
    { _id: trigger.watchGroupId },
    {
      $set: {
        ...(stillEnabled === 0 ? { enabled: false } : {}),
        executionAuthorizationStatus: 'invalid',
        executionAuthorizationCheckedAt: now,
        executionAuthorizationError: error,
        updatedAt: now,
      },
    },
  )
}

/**
 * Record that the execution identity was verified. `updatedAt` means "the
 * configuration last changed" everywhere else in the product, so a routine
 * run must not touch it — only a real status transition writes at all.
 */
async function markExecutionAuthorizationValid(trigger: AgentTrigger, now: Date): Promise<void> {
  if (executionAuthorizationIsCurrent(trigger)) return
  await agentTriggers().updateOne(
    { _id: trigger._id },
    {
      $set: {
        executionAuthorizationStatus: 'valid',
        executionAuthorizationCheckedAt: now,
      },
      $unset: { executionAuthorizationError: '' },
    },
  )
  if (!trigger.watchGroupId) return

  // A Group's partitions can be bound to different principals, so this run
  // says nothing about the others. Load them all — including disabled ones,
  // since an ingress the system paused for a broken identity still counts
  // against the Group — and let the shared predicate decide.
  const siblings = await agentTriggers()
    .find(
      { watchGroupId: trigger.watchGroupId, _id: { $ne: trigger._id } },
      { projection: { enabled: 1, executionAuthorizationStatus: 1 } },
    )
    .toArray()

  if (!triggerGroupExecutionIsHealthy(siblings)) return
  await agentTriggerGroups().updateOne(
    {
      _id: trigger.watchGroupId,
      $or: [
        { executionAuthorizationStatus: { $ne: 'valid' } },
        { executionAuthorizationError: { $exists: true } },
      ],
    },
    {
      $set: {
        executionAuthorizationStatus: 'valid',
        executionAuthorizationCheckedAt: now,
      },
      $unset: { executionAuthorizationError: '' },
    },
  )
}

/**
 * The Group owns its ingresses' execution identity, so a partition adopts it
 * before running.
 *
 * A transfer commits the Group document first and then fans out to the
 * ingresses; those are two collections and cannot be written atomically. This
 * closes that window from the side that matters: a partition that missed the
 * fan-out repairs itself here rather than running one more time as the
 * previous principal.
 */
async function reconcileGroupExecutionPrincipal(trigger: AgentTrigger): Promise<AgentTrigger> {
  if (!trigger.watchGroupId) return trigger
  const group = await agentTriggerGroups().findOne(
    { _id: trigger.watchGroupId },
    {
      projection: {
        executionPrincipalUserId: 1,
        credentialMode: 1,
        executionCredentialAccess: 1,
        createdByUserId: 1,
        userId: 1,
      },
    },
  )

  if (!group) return trigger
  const groupPrincipalUserId = triggerExecutionPrincipalId(group)

  if (groupPrincipalUserId === triggerExecutionPrincipalId(trigger)) return trigger

  const binding = {
    credentialMode: resolveTriggerGroupCredentialMode(group),
    ...(group.executionCredentialAccess
      ? { executionCredentialAccess: group.executionCredentialAccess }
      : {}),
  }
  const repaired: AgentTrigger = {
    ...trigger,
    executionPrincipalUserId: groupPrincipalUserId,
    ...binding,
    executionAuthorizationStatus: 'unchecked',
  }

  if (!group.executionCredentialAccess) delete repaired.executionCredentialAccess
  delete repaired.executionAuthorizationCheckedAt
  delete repaired.executionAuthorizationError
  await agentTriggers().updateOne(
    { _id: trigger._id },
    {
      $set: {
        executionPrincipalUserId: groupPrincipalUserId,
        ...binding,
        executionAuthorizationStatus: 'unchecked',
      },
      $unset: {
        ...(group.executionCredentialAccess ? {} : { executionCredentialAccess: true }),
        executionAuthorizationCheckedAt: true,
        executionAuthorizationError: true,
      },
    },
  )

  return repaired
}

export async function resolveExecutionAuthorization(inbound: AgentTrigger) {
  const trigger = await reconcileGroupExecutionPrincipal(inbound)
  const principalUserId = triggerExecutionPrincipalId(trigger)
  const now = new Date()

  if (trigger.teamId) {
    const membership = await getTeamMembership(principalUserId, trigger.teamId)

    if (!membership) {
      const error =
        'The Trigger creator is no longer a member of this team. The Trigger was paused.'

      await pauseIngressesForDepartedPrincipal(trigger, principalUserId, error, now)
      throw new AppError(409, 'trigger_execution_principal_invalid', error)
    }
  }

  // Recomputed every run so a connector granted or revoked since the last run
  // takes effect immediately. A Trigger the user narrowed is then held to that
  // scope, so only an explicit selection ever bounds a run.
  const currentAccess = await resolveTriggerCredentialAccess(trigger.teamId, principalUserId)
  const credentialAccess = triggerRunCredentialAccess(trigger, currentAccess)

  await markExecutionAuthorizationValid(trigger, now)

  return { principalUserId, credentialAccess }
}
