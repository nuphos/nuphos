import type { PendingCall } from './openab-acp-session.ts'

export type CallTimer = {
  /** Start the timer again; `progress` also restarts the progress window. */
  arm: (progress?: boolean) => ReturnType<typeof setTimeout>
  /** Whether the progress window, not the inactivity window, is what ran out. */
  stalled: () => boolean
  timeoutError: (method: string) => Error
}

/**
 * Two windows for one pending JSON-RPC call, applied as a single timer so every
 * `clearTimeout(pending.timer)` site stays correct.
 *
 * `inactivityMs` is restarted by any frame for the call's session, including
 * the runtime's liveness heartbeat, so it catches a dead socket or runtime.
 * `progressWindowMs` is restarted only by frames that show the turn advancing
 * (see `isTurnProgressUpdate`). A heartbeat proves the session is alive, not
 * that this prompt still has an agent working on it. Pass 0 to disable it.
 */
export function createCallTimer(
  onTimeout: () => void,
  inactivityMs: number,
  progressWindowMs = 0,
): CallTimer {
  let progressDeadline = progressWindowMs > 0 ? Date.now() + progressWindowMs : 0
  const stalled = () => progressDeadline > 0 && Date.now() >= progressDeadline

  return {
    arm: (progress = false) => {
      if (progress && progressWindowMs > 0) progressDeadline = Date.now() + progressWindowMs

      return setTimeout(
        onTimeout,
        progressDeadline > 0
          ? Math.max(0, Math.min(inactivityMs, progressDeadline - Date.now()))
          : inactivityMs,
      )
    },
    stalled,
    timeoutError: (method) =>
      new Error(
        stalled()
          ? `OpenAB ACP ${method} timed out: no turn progress for ${String(Math.round(progressWindowMs / 1000))}s`
          : `OpenAB ACP ${method} timed out`,
      ),
  }
}

const TURN_PROGRESS_UPDATES = new Set([
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
  'async_task_spawned',
  'async_task_progress',
  'async_task_state_update',
])

/** Heartbeats, usage and session-state broadcasts are liveness, not progress. */
export function isTurnProgressUpdate(params: unknown): boolean {
  if (!params || typeof params !== 'object') return false
  const update = (params as { update?: unknown }).update

  if (!update || typeof update !== 'object') return false

  return TURN_PROGRESS_UPDATES.has(String((update as { sessionUpdate?: unknown }).sessionUpdate))
}

/** Re-arm every pending call on the session a `session/update` frame names. */
export function refreshSessionTimers(pending: Iterable<PendingCall>, params: unknown): void {
  const sessionId = (params as { sessionId?: unknown } | undefined)?.sessionId

  if (typeof sessionId !== 'string') return
  const progress = isTurnProgressUpdate(params)

  for (const call of pending) {
    if (call.sessionId !== sessionId) continue
    clearTimeout(call.timer)
    call.timer = call.arm(progress)
  }
}
