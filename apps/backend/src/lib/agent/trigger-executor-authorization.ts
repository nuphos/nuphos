import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { getConversationBySessionId } from './db'
import { executionAuthorizationIsCurrent } from './trigger-access'
import { agentTriggers } from './trigger-db'
import { writeTrigger } from './trigger-history'

import type { AgentTrigger } from './trigger-db'
import type { Collection } from 'mongodb'

/**
 * Pause a Trigger that cannot run, with the reason shown on it. Its failed-run
 * count goes with it, so a resumed Trigger starts over. False when it was
 * already paused.
 */
export async function pauseTrigger(
  trigger: AgentTrigger,
  error: string,
  now: Date,
  triggers: Pick<Collection<AgentTrigger>, 'updateOne'> = agentTriggers(),
  via: 'authorization' | 'failed_runs' = 'authorization',
): Promise<boolean> {
  return writeTrigger(
    {
      before: trigger,
      after: { ...trigger, enabled: false },
      by: { actorId: 'system', via },
      reason: error,
    },
    async (session) =>
      (
        await triggers.updateOne(
          { _id: trigger._id, enabled: true },
          {
            $set: {
              enabled: false,
              executionAuthorizationStatus: 'invalid',
              executionAuthorizationCheckedAt: now,
              executionAuthorizationError: error,
              updatedAt: now,
            },
            $unset: { failedRunCount: '' },
            $inc: { configRevision: 1 },
          },
          { session },
        )
      ).modifiedCount > 0,
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
  if (target.archivedAt) {
    const error = 'The Task this Trigger belongs to is archived. The Trigger was paused.'

    await pauseTrigger(trigger, error, now)
    throw new AppError(409, 'trigger_target_session_archived', error)
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
