/**
 * Divides the pod's termination grace period among the stages of `shutdown()`
 * in `src/index.ts`.
 *
 * Must stay pure and dependency-free: `config.ts` calls it while building its
 * frozen singleton, so it cannot import the logger or anything reading `config`.
 */

export const HTTP_DRAIN_MS = 15_000

export const GUARD_FLUSH_MS = 2_000

export const SAFETY_MARGIN_MS = 3_000

/** What Kubernetes uses when a PodSpec omits `terminationGracePeriodSeconds`. */
export const DEFAULT_TERMINATION_GRACE_SECONDS = 30

export const DEFAULT_AGENT_DRAIN_DEADLINE_MS = 150_000

/** Time for k8s to observe readiness → 503 and deregister this pod. */
export const DEFAULT_LB_GRACE_MS = 5_000

export type ShutdownBudgetInput = {
  terminationGraceMs: number
  lbGraceMs: number
  agentDrainDeadlineMs: number
  httpDrainMs?: number
  guardFlushMs?: number
  safetyMarginMs?: number
}

export type ShutdownBudget = {
  terminationGraceMs: number
  lbGraceMs: number
  agentDrainDeadlineMs: number
  /**
   * When the drain stops waiting and force-pauses whatever is still running.
   * Held back from the deadline by `httpDrainMs + guardFlushMs` so the
   * `turn_paused` + done frames it emits still have a full HTTP-drain and flush
   * window to reach Redis before the process can be killed.
   */
  agentDrainForcePauseAtMs: number
  httpDrainMs: number
  guardFlushMs: number
  safetyMarginMs: number
  totalMs: number
  /** Slack between `totalMs` and the grace period. Negative means overrun. */
  headroomMs: number
  requestedAgentDrainDeadlineMs: number
  requestedLbGraceMs: number
  clamped: boolean
  /** False when even the untunable stages overflow the grace period. */
  fitsWithinGrace: boolean
}

/**
 * Clamps the tunable stages so that
 * `lbGrace + agentDrain + httpDrain + guardFlush <= terminationGrace`, with
 * `safetyMarginMs` to spare. The fixed tail is what delivers the pause frames,
 * so the agent drain absorbs the cut first and the LB grace only after it hits
 * zero.
 */
export function resolveShutdownBudget(input: ShutdownBudgetInput): ShutdownBudget {
  const httpDrainMs = input.httpDrainMs ?? HTTP_DRAIN_MS
  const guardFlushMs = input.guardFlushMs ?? GUARD_FLUSH_MS
  const safetyMarginMs = input.safetyMarginMs ?? SAFETY_MARGIN_MS
  const terminationGraceMs = Math.max(0, input.terminationGraceMs)

  const requestedLbGraceMs = Math.max(0, input.lbGraceMs)
  const requestedAgentDrainDeadlineMs = Math.max(0, input.agentDrainDeadlineMs)

  const reservedMs = httpDrainMs + guardFlushMs + safetyMarginMs

  const lbGraceMs = Math.min(requestedLbGraceMs, Math.max(0, terminationGraceMs - reservedMs))
  const availableForDrainMs = Math.max(0, terminationGraceMs - reservedMs - lbGraceMs)
  const agentDrainDeadlineMs = Math.min(requestedAgentDrainDeadlineMs, availableForDrainMs)

  const agentDrainForcePauseAtMs = Math.max(0, agentDrainDeadlineMs - (httpDrainMs + guardFlushMs))

  const totalMs = lbGraceMs + agentDrainDeadlineMs + httpDrainMs + guardFlushMs

  return {
    terminationGraceMs,
    lbGraceMs,
    agentDrainDeadlineMs,
    agentDrainForcePauseAtMs,
    httpDrainMs,
    guardFlushMs,
    safetyMarginMs,
    totalMs,
    headroomMs: terminationGraceMs - totalMs,
    requestedAgentDrainDeadlineMs,
    requestedLbGraceMs,
    clamped: agentDrainDeadlineMs < requestedAgentDrainDeadlineMs || lbGraceMs < requestedLbGraceMs,
    fitsWithinGrace: totalMs <= terminationGraceMs,
  }
}

export type DrainRunsOptions<TRun> = {
  listInFlight: () => TRun[]
  /** Must not throw. */
  forcePause: (run: TRun) => void
  forcePauseAtMs: number
  pollIntervalMs?: number
  onWaitStart?: (inFlightCount: number) => void
  onForcePause?: (inFlightCount: number, waitedMs: number) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export async function drainRunsUntilForcePause<TRun>(opts: DrainRunsOptions<TRun>): Promise<void> {
  const pollIntervalMs = opts.pollIntervalMs ?? 250
  const now = opts.now ?? (() => Date.now())
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const start = now()
  let inFlight = opts.listInFlight()

  if (inFlight.length > 0) opts.onWaitStart?.(inFlight.length)

  while (inFlight.length > 0 && now() - start < opts.forcePauseAtMs) {
    await sleep(pollIntervalMs)
    inFlight = opts.listInFlight()
  }

  if (inFlight.length === 0) return

  opts.onForcePause?.(inFlight.length, now() - start)
  for (const run of inFlight) opts.forcePause(run)
}
