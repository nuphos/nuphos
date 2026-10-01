import { logError, logEvent } from '@/lib/observability'

import { finishAgentRun } from './run-frames'
import { listInFlightAgentRuns } from './run-registry'
import { traceAgentChatEvent } from './trace'

import type { AgentRun } from './types'

/**
 * A run that has appended no frame for this long has lost its producer.
 *
 * Sits above every deadline that should have fired first — the ACP prompt's
 * progress window, the pump watchdog — so this only ever catches a run nothing
 * else owns any more: an agent-initiated turn whose runtime session went away,
 * or a producer that died between frames.
 */
export const RUN_FRAME_STALL_MS = 35 * 60 * 1000

/** Sweep cadence. The window is in tens of minutes; a minute of slack is fine. */
const RUN_STALL_SWEEP_INTERVAL_MS = 60 * 1000

/** Pure half of the sweeper: the in-flight runs that have gone silent. */
export function stalledAgentRuns(
  runs: AgentRun[],
  now: number,
  stallMs: number = RUN_FRAME_STALL_MS,
): AgentRun[] {
  return runs.filter((run) => now - run.lastFrameAt >= stallMs)
}

/**
 * End runs whose producer stopped emitting. Without this a stalled run keeps
 * its Redis owner lease and its session busy-guard alive forever (both ride the
 * ownership heartbeat, which is a timer, not a sign of life), so the user's
 * next message is refused and the UI stays on a stream that never closes.
 */
export function sweepStalledAgentRuns(now: number = Date.now()): number {
  const stalled = stalledAgentRuns(listInFlightAgentRuns(), now)

  for (const run of stalled) {
    traceAgentChatEvent('warn', 'agent.chat.run.stall_swept', run.trace, {
      frame_count: run.frames.length,
      last_finish_reason: run.lastFinishReason,
      run_age_ms: now - run.createdAt,
      silent_ms: now - run.lastFrameAt,
      stall_window_ms: RUN_FRAME_STALL_MS,
      subscriber_count: run.subscribers.size,
    })
    try {
      run.abortController.abort()
    } catch (err) {
      logError('agent.chat.run.stall_abort_failed', err, { stream_id: run.streamId })
    }
    finishAgentRun(run, 'producer-stalled')
  }

  return stalled.length
}

/** Start the periodic sweep. Returns a stop function for tests/shutdown. */
export function startAgentRunStallSweeper(
  intervalMs: number = RUN_STALL_SWEEP_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    try {
      sweepStalledAgentRuns()
    } catch (err) {
      logError('agent.chat.run.stall_sweep_failed', err, {})
    }
  }, intervalMs)

  timer.unref?.()
  logEvent('info', 'agent.chat.run.stall_sweeper_started', {
    stall_window_ms: RUN_FRAME_STALL_MS,
    interval_ms: intervalMs,
  })

  return () => {
    clearInterval(timer)
  }
}
