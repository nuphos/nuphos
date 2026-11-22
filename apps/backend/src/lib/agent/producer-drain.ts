import { connectedComputerCount } from '@/lib/agent/devices/local-runtime/held-tunnels'
import { logError, logEvent } from '@/lib/observability'

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

/** Snapshot only aggregate state when the existing shutdown deadline fires. */
export function createDrainDiagnostics(
  server: { pendingRequests: number; pendingWebSockets: number },
  workersStopped: Promise<unknown>,
) {
  let httpSettled = false
  let workersSettled = false

  void workersStopped.then(
    () => {
      workersSettled = true
    },
    () => {
      workersSettled = true
    },
  )

  return {
    trackHttp(promise: Promise<unknown>) {
      void promise.then(
        () => {
          httpSettled = true
        },
        () => {
          httpSettled = true
        },
      )

      return promise
    },
    snapshot() {
      return {
        http_stop_settled: httpSettled,
        workers_settled: workersSettled,
        agent_producers_in_flight: producers.size,
        http_pending_requests: server.pendingRequests,
        http_pending_websockets: server.pendingWebSockets,
        held_device_tunnels: connectedComputerCount(),
      }
    },
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

type HttpServer = {
  pendingRequests: number
  pendingWebSockets: number
  stop(force: boolean): Promise<void>
}

/** Drains HTTP and producers; at the deadline force-closes the servers and logs aggregate state. */
export async function stopHttpWithDeadline(
  server: HttpServer,
  devServer: Pick<HttpServer, 'stop'> | undefined,
  deadlineMs: number,
  workersStopped: Promise<unknown>,
): Promise<void> {
  const diagnostics = createDrainDiagnostics(server, workersStopped)
  const forceTimer = setTimeout(() => {
    logEvent('warn', 'backend.shutdown.drain_deadline_exceeded', {
      drain_deadline_ms: deadlineMs,
      ...diagnostics.snapshot(),
    })
    void server.stop(true)
    void devServer?.stop(true)
  }, deadlineMs)

  try {
    await drainHttpAndAgentProducers(
      () => diagnostics.trackHttp(Promise.all([server.stop(false), devServer?.stop(false)])),
      deadlineMs,
      workersStopped,
    )
  } catch (err) {
    logError('backend.shutdown.server_stop_failed', err)
  }
  clearTimeout(forceTimer)
}
