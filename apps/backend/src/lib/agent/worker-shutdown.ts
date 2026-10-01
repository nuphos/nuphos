import { closeTriggerQueues, stopTriggerWorkers } from './trigger-scheduler'

/** Stop consumers now; queue clients must remain usable by draining HTTP requests. */
export function quiesceAgentWorkers(): Promise<unknown> {
  return Promise.allSettled([stopTriggerWorkers()])
}

/** Called after HTTP and producer drains, before the shared Redis connection closes. */
export async function closeAgentWorkerQueues(): Promise<void> {
  await Promise.allSettled([closeTriggerQueues()])
}
