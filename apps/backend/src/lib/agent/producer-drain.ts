import { logEvent } from '@/lib/observability'

// Producer completion includes transcript persistence and cleanup after SSE has ended.
const producers = new Set<Promise<unknown>>()

export function trackAgentProducer<T>(produce: () => Promise<T>): Promise<T> {
  const promise = Promise.resolve().then(produce)

  producers.add(promise)
  void promise.then(
    () => producers.delete(promise),
    () => producers.delete(promise),
  )

  return promise
}

/** Uses the existing HTTP drain budget; never holds shutdown indefinitely. */
export async function drainAgentProducers(
  timeoutMs: number,
  workersStopped: Promise<unknown> = Promise.resolve(),
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const settled = async () => {
    await workersStopped
    while (producers.size > 0) await Promise.allSettled(producers)

    return true
  }

  try {
    return await Promise.race([
      settled(),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => {
          resolve(false)
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** HTTP requests may finish before their detached producer saves the transcript. */
export async function drainHttpAndAgentProducers(
  stop: () => Promise<unknown>,
  timeoutMs: number,
  workersStopped: Promise<unknown> = Promise.resolve(),
): Promise<void> {
  const [http, producerResult] = await Promise.allSettled([
    stop(),
    drainAgentProducers(timeoutMs, workersStopped),
  ])

  if (producerResult.status === 'fulfilled' && !producerResult.value) {
    logEvent('warn', 'backend.shutdown.producer_drain_timed_out')
  }
  if (http.status === 'rejected') throw http.reason
}
