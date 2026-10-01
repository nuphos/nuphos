import { bumpConversationActivity } from '@/lib/agent/db/read-state'
import { mirrorAgentRunFrame } from '@/lib/agent/run-store'
import { RunHandoff } from '@/lib/lifecycle'
import { logError, logEvent } from '@/lib/observability'
import { notifyAgentRunEnded, notifyApprovalRequested } from '@/lib/push/notify'
import { drainRunsUntilForcePause } from '@/lib/shutdown-budget'

import {
  AGENT_STREAM_DONE_EVENT,
  AGENT_TURN_COMPLETE_EVENT,
  AGENT_TURN_PAUSED_EVENT,
} from './constants'
import { agentStreamErrorFrame } from './errors'
import { listInFlightAgentRuns, scheduleAgentRunCleanup } from './run-registry'
import { traceAgentChatError, traceAgentChatEvent } from './trace'

import type { AgentRun } from './types'

export function appendAgentRunFrame(run: AgentRun, frame: string) {
  // Once a run is done, drop late frames (e.g. buffered chunks after an abort)
  // so nothing lands after the terminal paused/done frame in frames + Redis.
  if (run.done) {
    traceAgentChatEvent('warn', 'agent.chat.run.late_frame_dropped', run.trace, {
      frame_type: agentRunFrameType(frame),
      frame_bytes: frame.length,
      frame_count: run.frames.length,
      last_finish_reason: run.lastFinishReason,
      run_age_ms: Date.now() - run.createdAt,
    })

    return
  }
  run.frames.push(frame)
  run.lastAccessAt = Date.now()
  run.lastFrameAt = run.lastAccessAt
  mirrorAgentRunFrame(run.userId, run.streamId, frame)
  const frameType = agentRunFrameType(frame)

  if (
    frameType === 'error' ||
    frameType === AGENT_STREAM_DONE_EVENT ||
    frameType === AGENT_TURN_COMPLETE_EVENT ||
    frameType === AGENT_TURN_PAUSED_EVENT
  ) {
    traceAgentChatEvent('info', 'agent.chat.run.terminal_frame_appended', run.trace, {
      frame_type: frameType,
      frame_count: run.frames.length,
      frame_bytes: frame.length,
      last_finish_reason: run.lastFinishReason,
      run_age_ms: Date.now() - run.createdAt,
    })
  }
  if (frameType === AGENT_TURN_COMPLETE_EVENT || frameType === AGENT_TURN_PAUSED_EVENT) {
    recordConversationActivity(run)
  }
  if (frameType === 'tool-approval-request') notifyApprovalRequested(run)
  for (const subscriber of run.subscribers) subscriber.poke()
}

function recordConversationActivity(run: AgentRun) {
  run.activityRecorded = bumpConversationActivity(run.sessionId, run.userId).catch(
    (err: unknown) => {
      logError('agent.conversation.activity_bump_failed', err, {
        session_id: run.sessionId,
        stream_id: run.streamId,
      })
    },
  )
}

/**
 * Prep phases used to be a client-only SSE frame: a turn that wedged between
 * `request-accepted` and `connecting-model` left the user watching a spinner
 * and left us with nothing server-side to point at. Each transition is now a
 * timed lifecycle event, so "which phase was it in, and for how long" is a
 * query rather than an inference from silence.
 */
export function appendAgentRunPhase(run: AgentRun, phase: string) {
  const now = Date.now()
  const previousPhase = run.currentPhase
  const previousPhaseMs = now - (run.phaseStartedAt ?? run.createdAt)

  run.currentPhase = phase
  run.phaseStartedAt = now
  appendAgentRunFrame(run, `data: ${JSON.stringify({ type: 'phase', phase, emittedAt: now })}\n\n`)
  traceAgentChatEvent(
    'info',
    'agent.chat.phase',
    run.trace,
    { phase_name: phase, previous_phase: previousPhase ?? null },
    { previous_phase_ms: previousPhaseMs, since_run_start_ms: now - run.createdAt },
  )
}

/** True when the run's last frame already closed the stream. */
function hasTerminalFrame(run: AgentRun): boolean {
  const last = run.frames[run.frames.length - 1]

  return last !== undefined && agentRunFrameType(last) === AGENT_STREAM_DONE_EVENT
}

/**
 * Finish a run, guaranteeing its frame buffer ends with a terminal frame.
 *
 * Every well-behaved path appends `atlas-turn-complete`/`atlas-turn-paused` +
 * `atlas-stream-done` before calling this. The paths that do not are exactly
 * the ones that matter: an abort request finishing a run whose producer is
 * already gone, or a run whose ACP session died mid-turn. Flipping `done`
 * without a terminal frame satisfies local subscribers (they read `run.done`)
 * but strands every other reader, because a replica tailing the Redis mirror
 * has only `atlas-stream-done` to detect the end — so it keeps replaying
 * heartbeats against a buffer that never closes, for the full 2h key TTL.
 * Observed 2026-09-11: a stopped run released its owner lease while its Redis
 * buffer still ended on a `text-delta`.
 */
export function finishAgentRun(run: AgentRun, terminalPauseReason = 'stream-ended-without-result') {
  if (!run.done && !hasTerminalFrame(run)) {
    traceAgentChatEvent('warn', 'agent.chat.run.terminal_frame_synthesized', run.trace, {
      pause_reason: terminalPauseReason,
      frame_count: run.frames.length,
      last_finish_reason: run.lastFinishReason,
      run_age_ms: Date.now() - run.createdAt,
      aborted: run.abortController.signal.aborted,
    })
    appendAgentRunTurnPaused(run, terminalPauseReason, {
      aborted: run.abortController.signal.aborted,
    })
    appendAgentRunDone(run)
  }
  if (run.done) {
    traceAgentChatEvent('warn', 'agent.chat.run.finish_duplicate_ignored', run.trace, {
      frame_count: run.frames.length,
      last_finish_reason: run.lastFinishReason,
      run_age_ms: Date.now() - run.createdAt,
      subscriber_count: run.subscribers.size,
    })

    return
  }
  run.done = true
  run.lastAccessAt = Date.now()
  run.releaseOwnership()
  traceAgentChatEvent('info', 'agent.chat.run.finished', run.trace, {
    frame_count: run.frames.length,
    last_finish_reason: run.lastFinishReason,
    run_age_ms: Date.now() - run.createdAt,
    subscriber_count: run.subscribers.size,
  })
  for (const subscriber of run.subscribers) subscriber.poke()
  notifyAgentRunEnded(run)
  scheduleAgentRunCleanup(run)
}

export function appendAgentRunError(run: AgentRun, error: unknown) {
  traceAgentChatError('agent.chat.run.error_frame_appended', error, run.trace, {
    frame_count: run.frames.length,
    last_finish_reason: run.lastFinishReason,
    run_age_ms: Date.now() - run.createdAt,
    aborted: run.abortController.signal.aborted,
  })
  appendAgentRunFrame(
    run,
    `data: ${JSON.stringify(
      agentStreamErrorFrame(error, run.trace, {
        frame_count: run.frames.length,
        last_finish_reason: run.lastFinishReason,
        run_age_ms: Date.now() - run.createdAt,
        aborted: run.abortController.signal.aborted,
      }),
    )}\n\n`,
  )
}

export function appendAgentRunDone(run: AgentRun) {
  appendAgentRunFrame(run, `data: ${JSON.stringify({ type: AGENT_STREAM_DONE_EVENT })}\n\n`)
}

export function appendAgentRunTurnComplete(run: AgentRun) {
  appendAgentRunFrame(
    run,
    `data: ${JSON.stringify({
      type: AGENT_TURN_COMPLETE_EVENT,
      finishReason: run.lastFinishReason,
      // Lets clients join post-stream work (notably async memory ingest) to
      // this exact turn instead of guessing from session timestamps.
      turnKey: run.trace?.requestId,
    })}\n\n`,
  )
}

export function appendAgentRunTurnPaused(
  run: AgentRun,
  reason: string,
  detail?: Record<string, unknown>,
) {
  appendAgentRunFrame(
    run,
    `data: ${JSON.stringify({
      type: AGENT_TURN_PAUSED_EVENT,
      finishReason: run.lastFinishReason,
      reason,
      // The full cause chain (which phase stalled, how long it was silent, which
      // tool was mid-stream, the watchdog window that fired). The client surfaces
      // this so a paused/interrupted turn always traces back to a real reason
      // rather than a bare "Interrupted before the tool finished."
      ...(detail ? { detail } : {}),
    })}\n\n`,
  )
}

function agentRunFrameType(frame: string): string | undefined {
  if (frame.startsWith(':')) return 'comment'
  if (!frame.startsWith('data: ')) return undefined
  try {
    const payload = JSON.parse(frame.slice('data: '.length).trimEnd()) as { type?: unknown }

    return typeof payload.type === 'string' ? payload.type : undefined
  } catch {
    return 'malformed'
  }
}

/**
 * On shutdown, wait for in-flight agent runs to finish, then force-pause the
 * survivors with a resumable frame. A run is pod-local state, so exiting
 * mid-stream drops the SSE -> ingress 502.
 */
export async function drainInFlightAgentRuns(forcePauseAtMs: number): Promise<void> {
  await drainRunsUntilForcePause<AgentRun>({
    listInFlight: listInFlightAgentRuns,
    forcePauseAtMs,
    onWaitStart: (count) => {
      logEvent('info', 'agent.run.shutdown_drain_waiting', {
        in_flight_run_count: count,
        force_pause_at_ms: forcePauseAtMs,
      })
    },
    onForcePause: (count, waitedMs) => {
      logEvent('warn', 'agent.run.shutdown_force_pausing', {
        in_flight_run_count: count,
        force_pause_at_ms: forcePauseAtMs,
        waited_ms: waitedMs,
      })
    },
    forcePause: (run) => {
      try {
        run.abortController.abort(new RunHandoff('backend shutdown'))
        appendAgentRunTurnPaused(run, 'shutdown')
        appendAgentRunDone(run)
      } catch (err) {
        logError('agent.run.shutdown_pause_failed', err, { stream_id: run.streamId })
      }
      try {
        finishAgentRun(run)
      } catch (err) {
        logError('agent.run.shutdown_finish_failed', err, { stream_id: run.streamId })
      }
    },
  })
}
