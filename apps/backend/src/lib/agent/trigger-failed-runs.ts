import { ObjectId } from 'mongodb'

import { turnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'
import { USER_SETUP_MESSAGE, userSetupFailure } from '@/lib/claude-code-preview/plain-failure'
import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'

import { pauseTrigger } from './trigger-executor-authorization'
import { recordDroppedFire, runDeps, triggerIdOf } from './trigger-missed-runs'

import type { Delivered, TriggerRunDeps } from './trigger-missed-runs'

/** Fires in a row that fail for a lasting reason before their Trigger pauses. */
export const PAUSE_AFTER_FAILED_RUNS = 3

/**
 * Why a turn failed, in plain words, when the cause cannot pass with time: a
 * conversation too long for the model, a model the endpoint does not serve, an
 * agent CLI that cannot start, a signed-out agent, or a Box its team's plan
 * will not start. Undefined for anything
 * else, such as a usage limit.
 */
function lastingFailure(error: unknown): string | undefined {
  const setup = userSetupFailure(error)

  // The team's plan will not start its Box, until it changes or its hours come back.
  if (error instanceof AppError && error.code === 'box_vcpu_limit') return error.message

  if (setup) return USER_SETUP_MESSAGE[setup]
  for (let cause = error; cause instanceof Error; cause = cause.cause)
    if (turnFailureCause(cause) === 'auth')
      return 'This agent’s sign-in is no longer valid. Sign the agent in again.'

  return undefined
}

/**
 * A fire's turn failed for a lasting reason. The last of an unbroken run of
 * PAUSE_AFTER_FAILED_RUNS pauses the Trigger, with the reason shown on it and
 * sent to its owner.
 */
async function recordFailedFire(
  triggerId: string,
  reason: string,
  deps = runDeps(),
): Promise<void> {
  const _id = new ObjectId(triggerId)
  const trigger = await deps.triggers.findOneAndUpdate(
    { _id, enabled: true },
    { $inc: { failedRunCount: 1 } },
    { returnDocument: 'after' },
  )

  if (!trigger || (trigger.failedRunCount ?? 0) < PAUSE_AFTER_FAILED_RUNS) return
  const notice = `Paused after ${PAUSE_AFTER_FAILED_RUNS} runs in a row failed. ${reason} Then turn the Trigger back on.`

  if (!(await pauseTrigger(trigger, notice, new Date(), deps.triggers))) return
  logEvent('warn', 'agent.trigger.paused_after_failures', {
    trigger_id: triggerId,
    team_id: trigger.teamId,
  })
  if (trigger.targetSessionId && trigger.teamId) {
    deps.notify([trigger.userId], {
      sessionId: trigger.targetSessionId,
      teamId: trigger.teamId,
      title: 'Trigger paused',
      body: `${trigger.name}: ${notice}`,
    })
  }
}

/**
 * The fires among the messages of a turn that failed. A Trigger has no sender
 * to tell: a computer that stayed offline is a missed run, and a lasting
 * failure counts toward pausing it. Never throws: the turn is already failing
 * with `error`.
 */
export async function recordFailedFires(
  error: unknown,
  messages: readonly Delivered[],
  // Left to each record, so a turn with nothing to record never opens the database.
  deps?: TriggerRunDeps,
): Promise<void> {
  const offline = error instanceof AppError && error.code === 'runtime_offline'
  const reason = offline ? undefined : lastingFailure(error)

  if (!offline && !reason) return
  for (const message of messages) {
    const triggerId = triggerIdOf(message)

    if (!triggerId) continue
    try {
      if (reason) await recordFailedFire(triggerId, reason, deps)
      else await recordDroppedFire(triggerId, new Date(message.receivedAt), deps)
    } catch (err) {
      logError('agent.trigger.dropped_fire_record_failed', err, { trigger_id: triggerId })
    }
  }
}
