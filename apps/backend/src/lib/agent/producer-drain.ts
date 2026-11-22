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

type HttpServer = {
  pendingRequests: number
  pendingWebSockets: number
  stop(force: boolean): Promise<void>
}

/**
 * Stops accepting connections, waits for workers and producers within the deadline, then closes
 * what is still open. Agent runs have drained by now, so what remains are streams such as
 * /agent-changes that end only when their client leaves (#4318); their clients reconnect to a
 * ready replica.
 */
export async function stopHttpWithDeadline(
  server: HttpServer,
  devServer: Pick<HttpServer, 'stop'> | undefined,
  deadlineMs: number,
  workersStopped: Promise<unknown>,
): Promise<void> {
  const diagnostics = createDrainDiagnostics(server, workersStopped)
  const http = diagnostics.trackHttp(Promise.all([server.stop(false), devServer?.stop(false)]))

  if (await drainAgentProducers(deadlineMs, workersStopped)) {
    logEvent('info', 'backend.shutdown.http_closing', diagnostics.snapshot())
  } else {
    logEvent('warn', 'backend.shutdown.drain_deadline_exceeded', {
      drain_deadline_ms: deadlineMs,
      ...diagnostics.snapshot(),
    })
  }
  try {
    await Promise.all([server.stop(true), devServer?.stop(true), http])
  } catch (err) {
    logError('backend.shutdown.server_stop_failed', err)
  }
}
