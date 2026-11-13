import { parseUtcCron } from '@/lib/cron'
import { logError, logEvent } from '@/lib/observability'
import { notifyNudge } from '@/lib/push/notify'

import { agentTriggers, liveTriggerShapeFilter, triggerConfigRevisionFilter } from './trigger-db'

import type { AgentTrigger } from './trigger-db'
import type { Collection } from 'mongodb'

/** A fire counts as missed only once it is this overdue, so a slow queue is not reported. */
export const MISSED_RUN_GRACE_MS = 15 * 60 * 1000
const SWEEP_INTERVAL_MS = 5 * 60 * 1000

/** The latest scheduled time at or before `at`, or null for an unparseable schedule. */
function latestOccurrenceAtOrBefore(
  cronExpression: string,
  timeZone: string | undefined,
  at: Date,
): Date | null {
  try {
    // prev() is strictly earlier than its start, so start one second after `at`.
    const start = new Date(Math.floor(at.getTime() / 1000) * 1000 + 1000)

    return parseUtcCron(cronExpression, start, timeZone).prev().toDate()
  } catch {
    return null
  }
}

/**
 * The scheduled time of a fire that was due and never happened, else null.
 *
 * `legacyFloor` covers rows that predate `lastFiredAt`: their `lastRunAt` is
 * written only when a turn succeeds, so a failed or still-running last turn
 * looks like a miss. Until such a row fires once under the new code, only
 * fires due after `legacyFloor` (when this process started) can be reported.
 */
export function findMissedRun(
  trigger: Pick<
    AgentTrigger,
    | 'enabled'
    | 'triggerType'
    | 'cronExpression'
    | 'timeZone'
    | 'expiresAt'
    | 'createdAt'
    | 'updatedAt'
    | 'lastFiredAt'
    | 'lastRunAt'
  >,
  now: Date,
  legacyFloor: Date,
): Date | null {
  if (!trigger.enabled || trigger.triggerType !== 'cron' || !trigger.cronExpression) return null
  if (trigger.expiresAt && trigger.expiresAt.getTime() <= now.getTime()) return null
  const expected = latestOccurrenceAtOrBefore(
    trigger.cronExpression,
    trigger.timeZone,
    new Date(now.getTime() - MISSED_RUN_GRACE_MS),
  )

  if (!expected) return null
  // A new or just-edited schedule never reports a fire it was not yet running for.
  const scheduleSince = Math.max(trigger.createdAt.getTime(), trigger.updatedAt.getTime())

  if (expected.getTime() < scheduleSince) return null
  if (!trigger.lastFiredAt && expected.getTime() < legacyFloor.getTime()) return null
  const lastFire = trigger.lastFiredAt ?? trigger.lastRunAt

  if (lastFire && lastFire.getTime() >= expected.getTime()) return null

  return expected
}

function describeDueTime(expected: Date, timeZone = 'UTC'): string {
  // sv-SE renders year-month-day then 24-hour time, a stable shape for any reader.
  const formatted = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(expected)

  return `${formatted} (${timeZone})`
}

export type MissedRunSweepDeps = {
  triggers: Pick<Collection<AgentTrigger>, 'find' | 'findOneAndUpdate'>
  notify: typeof notifyNudge
}

/**
 * Claims one missed occurrence and says whether it opened an outage. The
 * filter re-checks what the decision rested on (configuration revision, no
 * fire since), so an edit or fire that landed meanwhile, or another
 * replica's claim of the same occurrence, matches nothing.
 */
async function claimMissedRun(
  trigger: AgentTrigger,
  expected: Date,
  deps: MissedRunSweepDeps,
): Promise<boolean> {
  const before = await deps.triggers.findOneAndUpdate(
    {
      _id: trigger._id,
      enabled: true,
      missedRunAt: { $ne: expected },
      $and: [
        triggerConfigRevisionFilter(trigger.configRevision ?? 0),
        { $or: [{ lastFiredAt: { $exists: false } }, { lastFiredAt: { $lt: expected } }] },
      ],
    },
    { $set: { missedRunAt: expected } },
    { returnDocument: 'before', projection: { missedRunAt: 1 } },
  )

  if (!before || before.missedRunAt) return false
  logEvent('warn', 'agent.trigger.missed_run', {
    trigger_id: trigger._id?.toString(),
    team_id: trigger.teamId,
    expected_at: expected.toISOString(),
  })
  if (trigger.targetSessionId && trigger.teamId) {
    deps.notify([trigger.userId], {
      sessionId: trigger.targetSessionId,
      teamId: trigger.teamId,
      title: 'Trigger missed a run',
      body: `${trigger.name} was due at ${describeDueTime(expected, trigger.timeZone)} and did not run.`,
    })
  }

  return true
}

/**
 * Keeps `missedRunAt` at the latest missed fire, claimed once per occurrence
 * across replicas, and alerts once per outage: only the claim that finds no
 * earlier `missedRunAt` notifies. A fire clears it, so the next outage alerts
 * again. One failing row is logged and skipped. Returns the alerts raised.
 */
export async function sweepMissedTriggerRuns(
  legacyFloor: Date,
  now = new Date(),
  deps: MissedRunSweepDeps = { triggers: agentTriggers(), notify: notifyNudge },
): Promise<number> {
  const candidates = await deps.triggers
    .find({ ...liveTriggerShapeFilter, triggerType: 'cron', enabled: true })
    .toArray()
  let alerted = 0

  for (const trigger of candidates) {
    try {
      const expected = findMissedRun(trigger, now, legacyFloor)

      if (trigger._id && expected && (await claimMissedRun(trigger, expected, deps))) alerted += 1
    } catch (err) {
      logError('agent.trigger.missed_run_failed', err, { trigger_id: trigger._id?.toString() })
    }
  }

  return alerted
}

let sweepTimer: ReturnType<typeof setInterval> | undefined
let sweeping = false

/** Plain in-process interval, deliberately not a queue job: a stuck queue must not silence it. */
export function startMissedRunDetector(): void {
  if (sweepTimer) return
  const startedAt = new Date()

  sweepTimer = setInterval(() => {
    if (sweeping) return
    sweeping = true
    sweepMissedTriggerRuns(startedAt)
      .catch((err: unknown) => {
        logError('agent.trigger.missed_run_sweep_failed', err)
      })
      .finally(() => {
        sweeping = false
      })
  }, SWEEP_INTERVAL_MS)
  sweepTimer.unref()
}

export function stopMissedRunDetector(): void {
  if (sweepTimer) clearInterval(sweepTimer)
  sweepTimer = undefined
}
