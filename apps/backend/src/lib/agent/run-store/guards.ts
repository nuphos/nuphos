import { logEvent } from '@/lib/observability'

// Releasing a busy guard is fire-and-forget: callers drop the returned closure on
// the floor and never await the DEL. That is fine while the process lives, but on
// SIGTERM `closeRedis()` and `process.exit(0)` follow the last run within
// milliseconds, so an unflushed DEL is simply lost and the session stays "busy"
// until its TTL lapses. Track those writes so shutdown can wait for them.
const pendingGuardWrites = new Set<Promise<unknown>>()

export function trackGuardWrite(write: Promise<unknown>): void {
  pendingGuardWrites.add(write)
  void write.catch(() => {}).finally(() => pendingGuardWrites.delete(write))
}

/** Wait for in-flight busy-guard releases to reach Redis. Called during shutdown
 *  before the Redis connection closes, so a turn that finished on a terminating
 *  replica does not leave its session locked behind a stale guard.
 *
 *  Returns how many releases actually landed — a write still in flight when the
 *  deadline expires, or one that failed, is not counted, and leaves the session
 *  to the owner-lease sweep instead. */
export async function flushGuardWrites(timeoutMs: number): Promise<number> {
  const pending = [...pendingGuardWrites]

  if (pending.length === 0) return 0
  logEvent('info', 'agent.run.guard_flush_waiting', {
    pending_write_count: pending.length,
    flush_timeout_ms: timeoutMs,
  })
  let landed = 0
  const counted = pending.map((write) =>
    write.then(
      () => {
        landed += 1
      },
      () => {},
    ),
  )

  await Promise.race([
    Promise.all(counted),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
  if (landed < pending.length) {
    logEvent('warn', 'agent.run.guard_flush_incomplete', {
      pending_write_count: pending.length,
      landed_write_count: landed,
      flush_timeout_ms: timeoutMs,
    })
  }

  return landed
}
