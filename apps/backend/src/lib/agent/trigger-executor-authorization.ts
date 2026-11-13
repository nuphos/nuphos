import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { getConversationBySessionId } from './db'
import { executionAuthorizationIsCurrent } from './trigger-access'
import { agentTriggers } from './trigger-db'

import type { AgentTrigger } from './trigger-db'

/** Pause a Trigger whose Task or Task owner can no longer run it. */
async function pauseTrigger(trigger: AgentTrigger, error: string, now: Date): Promise<void> {
  await agentTriggers().updateOne(
    { _id: trigger._id },
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

/** A Trigger runs in its Task, as that Task's owner. */
export async function resolveExecutionAuthorization(trigger: AgentTrigger) {
  const now = new Date()
  const target = trigger.targetSessionId
    ? await getConversationBySessionId(trigger.targetSessionId)
    : null

  if (!target?.teamId || target.teamId !== trigger.teamId) {
    const error = 'The Task this Trigger belongs to no longer exists. The Trigger was paused.'

    await pauseTrigger(trigger, error, now)
    throw new AppError(409, 'trigger_target_session_invalid', error)
  }
  if (!(await getTeamMembership(target.userId, target.teamId))) {
    const error =
      "The owner of this Trigger's Task is no longer a member of this team. The Trigger was paused."

    await pauseTrigger(trigger, error, now)
    throw new AppError(409, 'trigger_execution_principal_invalid', error)
  }
  await markExecutionAuthorizationValid(trigger, now)

  return { target }
}
