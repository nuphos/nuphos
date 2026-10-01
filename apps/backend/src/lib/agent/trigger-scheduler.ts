import { Queue, Worker } from 'bullmq'
import { ObjectId } from 'mongodb'

import { CRON_TIME_ZONE } from '@/lib/cron'
import { logError, logEvent } from '@/lib/observability'
import { redisEnabled } from '@/lib/redis'

import { agentTriggers, liveTriggerShapeFilter } from './trigger-db'
import { executeTrigger } from './trigger-executor'
import { buildBullMQConnection } from './trigger-scheduler-setup'
// Straight to the two section modules, not the trigger-service barrel: the
// barrel would also pull create/update/transfer into our graph and widen the
// cycle below to files we never touch.
import { performTriggerCleanup } from './trigger-service/cleanup'
// Runtime-only cycle with trigger-service/read (it schedules through us, we
// sweep through it) — both sides defer usage to call time, so module eval is
// safe.
import { expireTriggers } from './trigger-service/read'

export { buildBullMQConnection } from './trigger-scheduler-setup'

const QUEUE_NAME = 'atlas-agent-triggers'
const EXPIRY_SWEEP_JOB = 'expire-triggers'
const PROVIDER_CLEANUP_JOB = 'cleanup-trigger-provider'

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

  _queue = new Queue(QUEUE_NAME, { connection })

  _worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === EXPIRY_SWEEP_JOB) {
        const expired = await expireTriggers()

        if (expired > 0) logEvent('info', 'agent.trigger.expiry_sweep', { expired })

        return
      }
      if (job.name === PROVIDER_CLEANUP_JOB) {
        const { triggerId } = job.data as { triggerId: string }

        await performTriggerCleanup(triggerId)

        return
      }
      const { triggerId } = job.data as { triggerId: string }
      const trigger = await agentTriggers().findOne({ _id: new ObjectId(triggerId) })

      if (!trigger?.enabled) return
      // Belt-and-braces: the hourly sweep is the primary expiry path, but a
      // fire that races it must not execute an already-expired trigger.
      if (trigger.expiresAt && trigger.expiresAt.getTime() <= Date.now()) return
      if (trigger.triggerType !== 'cron') return
      await executeTrigger(trigger, undefined, { runKind: 'scheduled' })
    },
    { connection, concurrency: 3 },
  )

  _worker.on('failed', (job, err) => {
    logError('agent.trigger_scheduler.job_failed', err, { job_id: job?.id })
  })

  const cronTriggers = await agentTriggers()
    .find({ ...liveTriggerShapeFilter, triggerType: 'cron', enabled: true })
    .toArray()

  for (const trigger of cronTriggers) {
    if (trigger._id && trigger.cronExpression) {
      await _upsertJobScheduler(trigger._id.toString(), trigger.cronExpression)
    }
  }
  const removedOrphanCount = await removeOrphanJobSchedulers()

  // Recover deletions claimed before a process restart. The cleanup worker is
  // idempotent and the persisted receipt remains the source of truth.
  const deletingTriggers = await agentTriggers()
    .find({ cleanupStatus: 'deleting' }, { projection: { _id: 1 } })
    .toArray()
  let resumedCleanupCount = 0

  for (const trigger of deletingTriggers) {
    if (!trigger._id) continue
    try {
      if (await scheduleTriggerCleanup(trigger._id.toString())) {
        resumedCleanupCount += 1
      }
    } catch (err) {
      logError('agent.trigger.provider_cleanup_recovery_failed', err, {
        trigger_id: trigger._id.toString(),
      })
    }
  }

  // Hourly expiry sweep: disables triggers whose expiresAt has passed.
  await _queue.upsertJobScheduler(
    'trigger-expiry-sweep',
    { pattern: '0 * * * *' },
    { name: EXPIRY_SWEEP_JOB, opts: { attempts: 1, removeOnComplete: 24, removeOnFail: 24 } },
  )

  logEvent('info', 'agent.trigger_scheduler.initialized', {
    cron_trigger_count: cronTriggers.length,
    resumed_cleanup_count: resumedCleanupCount,
    removed_orphan_schedule_count: removedOrphanCount,
  })

  return true
}

export async function stopTriggerWorkers(): Promise<void> {
  await _worker?.close()
  _worker = undefined
}

export async function closeTriggerQueues(): Promise<void> {
  await _queue?.close()
  _queue = undefined
}

export async function shutdownTriggerScheduler(): Promise<void> {
  await stopTriggerWorkers()
  await closeTriggerQueues()
}

async function _upsertJobScheduler(triggerId: string, cronExpression: string): Promise<void> {
  await _queue!.upsertJobScheduler(
    `trigger:${triggerId}`,
    { pattern: cronExpression, tz: CRON_TIME_ZONE },
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
): Promise<void> {
  if (!_queue) return
  await _upsertJobScheduler(triggerId, cronExpression)
}

export async function unscheduleCronTrigger(triggerId: string): Promise<void> {
  if (!_queue) return
  await _queue.removeJobScheduler(`trigger:${triggerId}`)
}

/** Returns false when Redis is disabled so the caller can run synchronously. */
export async function scheduleTriggerCleanup(triggerId: string): Promise<boolean> {
  if (!_queue) return false
  await _queue.add(
    PROVIDER_CLEANUP_JOB,
    { triggerId },
    {
      jobId: `provider-cleanup-${triggerId}`,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  )

  return true
}
