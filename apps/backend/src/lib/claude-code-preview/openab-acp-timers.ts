import { OpenAbTimeoutError } from './turn-diagnostics'

import type { PendingCall } from './openab-acp-session.ts'

export type CallTimer = {
  /** Start the timer again; `progress` also restarts the progress window. */
  arm: (progress?: boolean) => ReturnType<typeof setTimeout>
  /** Whether the progress window, not the inactivity window, is what ran out. */
  stalled: () => boolean
  timeoutError: (method: string, sessionScoped: boolean) => Error
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
 * `firstOutputMs`, when set, replaces the progress window until the first
 * progress frame: an agent whose model provider never answers sends nothing
 * at all, and that should not take the full progress window to notice.
 */
export function createCallTimer(
  onTimeout: () => void,
  inactivityMs: number,
  progressWindowMs = 0,
  firstOutputMs = 0,
): CallTimer {
  const firstWindowMs =
    firstOutputMs > 0 && progressWindowMs > 0
      ? Math.min(firstOutputMs, progressWindowMs)
      : progressWindowMs
  let progressed = false
  let progressDeadline = firstWindowMs > 0 ? Date.now() + firstWindowMs : 0
  const stalled = () => progressDeadline > 0 && Date.now() >= progressDeadline

  return {
    arm: (progress = false) => {
      if (progress) {
        progressed = true
        progressDeadline = progressWindowMs > 0 ? Date.now() + progressWindowMs : 0
      }

      return setTimeout(
        onTimeout,
        progressDeadline > 0
          ? Math.max(0, Math.min(inactivityMs, progressDeadline - Date.now()))
          : inactivityMs,
      )
    },
    stalled,
    timeoutError: (method, sessionScoped) => {
      const progressExpired = stalled()
      const otherKind = sessionScoped ? 'inactivity' : 'call-deadline'
      const windowMs = progressed ? progressWindowMs : firstWindowMs
      const silence =
        !progressed && firstWindowMs < progressWindowMs ? 'model output' : 'turn progress'

      return new OpenAbTimeoutError(
        progressExpired
          ? `OpenAB ACP ${method} timed out: no ${silence} for ${String(Math.round(windowMs / 1000))}s`
          : `OpenAB ACP ${method} timed out`,
        progressExpired ? 'progress' : otherKind,
        progressExpired ? windowMs : inactivityMs,
      )
    },
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

  const { sessionUpdate, content, messageId } = update as {
    sessionUpdate?: unknown
    content?: { text?: unknown }
    messageId?: unknown
  }

  return (
    TURN_PROGRESS_UPDATES.has(String(sessionUpdate)) && !isAdapterWarning(content?.text, messageId)
  )
}

// Codex's adapter relays its own warnings (such as missing model metadata, on
// every turn with a custom provider) as message text with no message id. They
// are not the model's output, so they must not end a stalled turn's window.
export function isAdapterWarning(text: unknown, messageId: unknown): boolean {
  return !messageId && typeof text === 'string' && /^(Warning|Config warning): /.test(text)
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
