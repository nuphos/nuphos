import { logEvent } from '@/lib/observability'

// A Redis or socket timeout can be the symptom of this process not running for
// a second: a handler that blocks the event loop. This names when that happens
// and what was being served, which nothing else records.

const CHECK_MS = 100
const STALL_MS = 500
const QUIET_MS = 10_000
const MAX_LISTED = 20

const inFlight = new Set<{ method: string; path: string; startedAt: number }>()

/** Marks a request as being served until the returned function is called. */
export function trackInFlight(method: string, path: string): () => void {
  const request = { method, path, startedAt: performance.now() }

  inFlight.add(request)

  return () => inFlight.delete(request)
}

/** Runs `work` as in flight under `kind name`: a background job, which no request names. */
export async function serving<T>(kind: string, name: string, work: () => Promise<T>): Promise<T> {
  const done = trackInFlight(kind, name)

  try {
    return await work()
  } finally {
    done()
  }
}

/**
 * A timer that fires late by more than STALL_MS means the loop was blocked: logs
 * `backend.event_loop.stalled` with how long, and the requests in flight across
 * it, at most once per QUIET_MS. Returns a stop function.
 */
export function startEventLoopStallLog(log: typeof logEvent = logEvent): () => void {
  let last = performance.now()
  let logged = -Infinity
  const timer = setInterval(() => {
    const now = performance.now()
    const stall = now - last - CHECK_MS

    last = now
    if (stall < STALL_MS || now - logged < QUIET_MS) return
    logged = now
    log('warn', 'backend.event_loop.stalled', {
      stall_ms: Math.round(stall),
      in_flight_count: inFlight.size,
      in_flight: [...inFlight]
        .slice(0, MAX_LISTED)
        .map((r) => `${r.method} ${r.path} (${String(Math.round(now - r.startedAt))} ms)`),
      heap_used_mb: Math.round(process.memoryUsage().heapUsed / 2 ** 20),
    })
  }, CHECK_MS)

  timer.unref()

  return () => {
    clearInterval(timer)
  }
}
