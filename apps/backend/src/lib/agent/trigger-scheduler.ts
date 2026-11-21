import { Queue, Worker } from 'bullmq'
import { ObjectId } from 'mongodb'

import { CRON_TIME_ZONE, spreadWithinMinute } from '@/lib/cron'
import { serving } from '@/lib/event-loop-stall'
import { logError, logEvent } from '@/lib/observability'
import { redisEnabled } from '@/lib/redis'

import { closeThreadQueue } from './thread-queue'
import { agentTriggers, liveTriggerShapeFilter } from './trigger-db'
import { executeTrigger } from './trigger-executor'
import { startMissedRunDetector, stopMissedRunDetector } from './trigger-missed-runs'
import { AGENT_TRIGGER_QUEUE, buildBullMQConnection } from './trigger-scheduler-setup'
// Straight to the section module, not the trigger-service barrel: the barrel
// would also pull create/update/transfer into our graph and widen the cycle
// below to files we never touch. Runtime-only cycle with trigger-service/read
// (it schedules through us, we sweep through it) — both sides defer usage to
// call time, so module eval is safe.
import { expireTriggers } from './trigger-service/read'

export { buildBullMQConnection } from './trigger-scheduler-setup'

const EXPIRY_SWEEP_JOB = 'expire-triggers'
const HELD_FLUSH_JOB = 'flush-held-deliveries'

let _queue: Queue | undefined
let _worker: Worker | undefined

/** Returns `true` if the scheduler started, `false` if it was skipped (Redis
 *  disabled). Throws when Redis is enabled but misconfigured. */
export async function initTriggerScheduler(): Promise<boolean> {
  if (!redisEnabled()) {
    logEvent('warn', 'agent.trigger_scheduler.redis_disabled')

    return false
  }

  const connection = buildBullMQConnection()

  _queue = new Queue(AGENT_TRIGGER_QUEUE, { connection })

  _worker = new Worker(
    AGENT_TRIGGER_QUEUE,
    // A stall during a job names it, as it names the requests being served.
    async (job) =>
      serving('job', job.name, async () => {
        if (job.name === 'task-report') {
          const { deliverTaskReport } = await import('./task-report-delivery')

          await deliverTaskReport(job.data.reportId)

          return
        }
        if (job.name === 'recover-task-reports') {
          const { recoverTaskReports } = await import('./task-reports')

          await recoverTaskReports()

          return
        }
        if (job.name === 'resource-session-turn') {
          const { executeResourceTurn } = await import('./resource-turn')

          await executeResourceTurn(job.data)

          return
        }
        if (job.name === 'answer-delivery') {
          const { deliverWaitingAnswers } = await import('./deliver-waiting-answers')

          await deliverWaitingAnswers((job.data as { sessionId: string }).sessionId)

          return
        }
        if (job.name === HELD_FLUSH_JOB) {
          const { flushHeldDeliveries } = await import('./trigger-held-flush')

          const { triggerId } = job.data as { triggerId: string }

          await flushHeldDeliveries(triggerId, (delayMs) => enqueueHeldFlush(triggerId, delayMs))

          return
        }
        if (job.name === EXPIRY_SWEEP_JOB) {
          const expired = await expireTriggers()

          if (expired > 0) logEvent('info', 'agent.trigger.expiry_sweep', { expired })

          return
        }
        const { triggerId } = job.data as { triggerId: string }
        const trigger = await agentTriggers().findOne({ _id: new ObjectId(triggerId) })

        if (!trigger?.enabled) return
        // Belt-and-braces: the hourly sweep is the primary expiry path, but a
        // fire that races it must not execute an already-expired trigger.
        if (trigger.expiresAt && trigger.expiresAt.getTime() <= Date.now()) return
        if (trigger.triggerType !== 'cron') return
        // Recorded before the turn so a long or failing turn still counts as fired.
        // A missed run is over only once a turn has run (recordTriggerRan).
        await agentTriggers().updateOne({ _id: trigger._id }, { $set: { lastFiredAt: new Date() } })
        await executeTrigger(trigger, undefined, {
          runKind: 'scheduled',
          ...(job.id ? { fireId: job.id } : {}),
        })
      }),
    { connection, concurrency: 3 },
  )

  _worker.on('failed', (job, err) => {
    void whoseJob(job?.data).then((owner) =>
      { logError('agent.trigger_scheduler.job_failed', err, { job_id: job?.id, ...owner }); },
    )
    if (job?.name === 'task-report') {
      void import('./task-reports')
        .then(({ taskReports }) =>
          taskReports().updateOne(
            { _id: job.data.reportId },
            {
              $set: {
                deliveryError:
                  'Report notification failed; inspect the parent conversation and queue before retrying.',
              },
            },
          ),
        )
        .catch((error: unknown) => {
          logError('agent.task_report.failure_record_failed', error)
        })
    }
  })

  await _queue.upsertJobScheduler(
    'task-report-recovery',
    { every: 60_000 },
    {
      name: 'recover-task-reports',
      opts: { removeOnComplete: 1, removeOnFail: 10 },
    },
  )

  const cronTriggers = await agentTriggers()
    .find({ ...liveTriggerShapeFilter, triggerType: 'cron', enabled: true })
    .toArray()

  for (const trigger of cronTriggers) {
    if (trigger._id && trigger.cronExpression) {
      await _upsertJobScheduler(trigger._id.toString(), trigger.cronExpression, trigger.timeZone)
    }
  }
  const removedOrphanCount = await removeOrphanJobSchedulers()

  // Hourly expiry sweep: disables triggers whose expiresAt has passed.
  await _queue.upsertJobScheduler(
    'trigger-expiry-sweep',
    { pattern: '0 * * * *' },
    { name: EXPIRY_SWEEP_JOB, opts: { attempts: 1, removeOnComplete: 24, removeOnFail: 24 } },
  )

  startMissedRunDetector()

  logEvent('info', 'agent.trigger_scheduler.initialized', {
    cron_trigger_count: cronTriggers.length,
    removed_orphan_schedule_count: removedOrphanCount,
  })

  return true
}

export async function stopTriggerWorkers(): Promise<void> {
  stopMissedRunDetector()
  await _worker?.close()
  _worker = undefined
}

export async function closeTriggerQueues(): Promise<void> {
  await closeThreadQueue()
  await _queue?.close()
  _queue = undefined
}

export async function shutdownTriggerScheduler(): Promise<void> {
  await stopTriggerWorkers()
  await closeTriggerQueues()
}

async function _upsertJobScheduler(
  triggerId: string,
  cronExpression: string,
  timeZone = CRON_TIME_ZONE,
): Promise<void> {
  await _queue!.upsertJobScheduler(
    `trigger:${triggerId}`,
    // Within the scheduled minute: hourly Triggers otherwise all start at :00:00 together.
    { pattern: spreadWithinMinute(triggerId, cronExpression), tz: timeZone },
    {
      name: 'run-trigger',
      data: { triggerId },
      opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 50 },
    },
  )
}

/** Drops cron schedules whose trigger row is gone or no longer an enabled cron. */
async function removeOrphanJobSchedulers(): Promise<number> {
  let removed = 0

  for (const { key } of await _queue!.getJobSchedulers()) {
    const triggerId = key.startsWith('trigger:') ? key.slice('trigger:'.length) : undefined

    if (!triggerId || !ObjectId.isValid(triggerId)) continue
    const live = await agentTriggers().countDocuments({
      ...liveTriggerShapeFilter,
      _id: new ObjectId(triggerId),
      triggerType: 'cron',
      enabled: true,
    })

    if (live > 0) continue
    await _queue!.removeJobScheduler(key)
    removed += 1
  }

  return removed
}

export async function scheduleCronTrigger(
  triggerId: string,
  cronExpression: string,
  timeZone?: string,
): Promise<void> {
  if (!_queue) return
  await _upsertJobScheduler(triggerId, cronExpression, timeZone)
}

/** One delayed flush per Trigger: a second hold inside the same window joins the first. */
export async function enqueueHeldFlush(triggerId: string, delayMs: number): Promise<boolean> {
  if (!_queue) return false
  await _queue.add(
    HELD_FLUSH_JOB,
    { triggerId },
    { jobId: `flush-${triggerId}`, delay: delayMs, removeOnComplete: true, removeOnFail: 50 },
  )

  return true
}

export async function unscheduleCronTrigger(triggerId: string): Promise<void> {
  if (!_queue) return
  await _queue.removeJobScheduler(`trigger:${triggerId}`)
}

/** The Trigger a failed fire belongs to, so its log line says whose it is (#3718). */
async function whoseJob(data: unknown): Promise<Record<string, string | undefined>> {
  const triggerId = (data as { triggerId?: unknown } | undefined)?.triggerId

  if (typeof triggerId !== 'string' || !ObjectId.isValid(triggerId)) return {}
  const trigger = await agentTriggers()
    .findOne({ _id: new ObjectId(triggerId) }, { projection: { teamId: 1, targetSessionId: 1 } })
    .catch(() => null)

  return { trigger_id: triggerId, team_id: trigger?.teamId, session_id: trigger?.targetSessionId }
}
