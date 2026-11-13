import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { getConversationBySessionId } from './db'
import {
  executionAuthorizationIsCurrent,
  triggerExecutionPrincipalFilter,
  triggerExecutionPrincipalId,
} from './trigger-access'
import { agentTriggers } from './trigger-db'

import type { AgentTrigger } from './trigger-db'

/**
 * Pause a Trigger whose execution identity or delivery target broke, unless a
 * transfer already moved it to another principal.
 */
async function pauseTrigger(
  trigger: AgentTrigger,
  principalUserId: string,
  error: string,
  now: Date,
): Promise<void> {
  await agentTriggers().updateOne(
    { _id: trigger._id, ...triggerExecutionPrincipalFilter(principalUserId) },
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
}

export async function resolveExecutionAuthorization(trigger: AgentTrigger) {
  const principalUserId = triggerExecutionPrincipalId(trigger)
  const now = new Date()

  if (trigger.teamId) {
    const membership = await getTeamMembership(principalUserId, trigger.teamId)

    if (!membership) {
      const error =
        'The Trigger creator is no longer a member of this team. The Trigger was paused.'

      await pauseTrigger(trigger, principalUserId, error, now)
      throw new AppError(409, 'trigger_execution_principal_invalid', error)
    }
  }
  // Unbound rows predate binding. They have nowhere to deliver, so they stay
  // off until their owner picks a conversation.
  const target = trigger.targetSessionId
    ? await getConversationBySessionId(trigger.targetSessionId)
    : null

  if (!target?.teamId || target.teamId !== trigger.teamId || target.userId !== principalUserId) {
    const error = trigger.targetSessionId
      ? "The session this Trigger delivers to was deleted or no longer belongs to the Trigger's owner. The Trigger was paused."
      : 'This Trigger has no session to deliver to. The Trigger was paused.'

    await pauseTrigger(trigger, principalUserId, error, now)
    throw new AppError(
      409,
      trigger.targetSessionId
        ? 'trigger_target_session_invalid'
        : 'trigger_target_session_required',
      error,
    )
  }
  await markExecutionAuthorizationValid(trigger, now)

  return { target }
}
