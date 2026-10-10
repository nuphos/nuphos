import { Queue } from 'bullmq'

import { redisEnabled } from '@/lib/redis'

import { AGENT_TRIGGER_QUEUE, buildBullMQConnection } from './trigger-scheduler-setup'

import type { ResourceTurn } from './resource-webhook'
import type { ThreadTurn } from './thread-bridge'

// A producer-only connection: importing tools must not load the worker/route graph.
let queue: Queue | undefined

export async function enqueueThreadTurn(data: ThreadTurn): Promise<void> {
  if (!redisEnabled()) throw new Error('Background thread queue requires Redis.')
  queue ??= new Queue(AGENT_TRIGGER_QUEUE, { connection: buildBullMQConnection() })
  await queue.add('agent-thread-turn', data, {
    jobId: data.messageId,
    attempts: 1,
    removeOnComplete: { age: 30 * 86400 },
    removeOnFail: false,
  })
}

export async function closeThreadQueue(): Promise<void> {
  const closing = queue

  queue = undefined
  await closing?.close()
}

export async function enqueueResourceTurn(data: ResourceTurn): Promise<void> {
  if (!redisEnabled()) throw new Error('Resource event queue requires Redis.')
  queue ??= new Queue(AGENT_TRIGGER_QUEUE, { connection: buildBullMQConnection() })
  await queue.add('resource-session-turn', data, {
    jobId: data.messageId,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 30 * 86400 },
    removeOnFail: false,
  })
}
