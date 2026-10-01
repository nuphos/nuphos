import { mayRestartFreshAfterStreamError } from '../agent-stream-retry.ts'

import {
  CHAT_STREAM_FRESH_RETRY_BASE_MS,
  CHAT_STREAM_FRESH_RETRY_MAX_ATTEMPTS,
  CHAT_STREAM_FRESH_RETRY_MAX_MS,
  CHAT_STREAM_IDLE_MAX_ATTEMPTS,
  CHAT_STREAM_IDLE_TIMEOUT_MS,
  CHAT_STREAM_NO_CONTENT_TIMEOUT_MS,
  traceStream,
} from './chat-shared.ts'
import { abortableSleep, formatAgentLocalError } from './stream-errors.ts'

import type { ChatStreamCtx } from './chat-shared.ts'

/**
 * Decide what happens after one drained response body: complete the turn,
 * retry the loop, or stop. Throws when the reconnect path should take over.
 */
export async function resolveStreamOutcome(
  ctx: ChatStreamCtx,
  read: {
    idleTimedOut: boolean
    contentStalled: boolean
    needsFreshRetry: boolean
    freshRetryReason: string | null
    interruptionFrame?: Record<string, unknown>
  },
  shouldResume: boolean,
  turnStartedAtMs: number,
  firstFrameSeen: boolean,
): Promise<'retry' | 'stop' | 'completed'> {
  const { streamId, sessionId, teamId, explicitResume, state, emit } = ctx
  const { idleTimedOut, contentStalled, needsFreshRetry, freshRetryReason } = read

  // Heartbeats without frames long enough that the run behind this stream is
  // gone. Reconnecting re-attaches to the same dead run, so surface it instead:
  // the user gets an error they can retry rather than an endless spinner.
  if (contentStalled && !state.terminalEventDetected) {
    traceStream(
      'content_stalled',
      { streamId, sessionId },
      { timeout_ms: CHAT_STREAM_NO_CONTENT_TIMEOUT_MS, resume_from: state.resumeFrom },
      'warn',
    )
    emit({
      type: 'error',
      error: formatAgentLocalError(
        `Agent stream carried only heartbeats for ${String(CHAT_STREAM_NO_CONTENT_TIMEOUT_MS)}ms; the run behind it is no longer producing output.`,
        {
          phase: 'content_stalled',
          streamId,
          sessionId,
          teamId,
          resumeFrom: state.resumeFrom,
          reconnectAttempts: state.reconnectAttempts,
          freshRetryAttempts: state.freshRetryAttempts,
          explicitResume,
          shouldResume,
        },
      ),
    })

    return 'stop'
  }

  if (idleTimedOut && !state.terminalEventDetected && !needsFreshRetry) {
    state.idleTimeouts += 1
    traceStream(
      'idle_timeout',
      { streamId, sessionId },
      {
        attempt: state.idleTimeouts,
        timeout_ms: CHAT_STREAM_IDLE_TIMEOUT_MS,
        resume_from: state.resumeFrom,
      },
      'warn',
    )
    if (state.idleTimeouts > CHAT_STREAM_IDLE_MAX_ATTEMPTS) {
      emit({
        type: 'error',
        error: formatAgentLocalError(
          `Agent stream received no SSE frame or heartbeat for ${String(CHAT_STREAM_IDLE_TIMEOUT_MS)}ms after ${String(state.idleTimeouts)} idle reconnect attempts.`,
          {
            phase: 'idle_timeout_exhausted',
            streamId,
            sessionId,
            teamId,
            resumeFrom: state.resumeFrom,
            reconnectAttempts: state.reconnectAttempts,
            freshRetryAttempts: state.freshRetryAttempts,
            explicitResume,
            shouldResume,
          },
        ),
      })

      return 'stop'
    }
    // Don't let idle timeouts also drain the general transport budget.
    state.reconnectAttempts = 0
    throw new Error('Chat stream idle timeout (no frames or heartbeat received)')
  }
  if (needsFreshRetry) {
    // One budget for "this turn's stream broke mid-response", whichever way the
    // attempt is then retried. It is only ever incremented, whereas
    // reconnectAttempts is reset by every legitimate frame — so a stream that
    // flaps between a frame and an error frame still converges to a surfaced
    // error here instead of re-attaching silently forever.
    state.freshRetryAttempts += 1
    if (state.freshRetryAttempts > CHAT_STREAM_FRESH_RETRY_MAX_ATTEMPTS) {
      if (read.interruptionFrame) emit({ type: 'sse', data: read.interruptionFrame })
      emit({
        type: 'error',
        error:
          freshRetryReason ??
          formatAgentLocalError(
            'Agent stream fresh retry budget was exhausted after mid-stream error frames.',
            {
              phase: 'fresh_retry_exhausted',
              streamId,
              sessionId,
              teamId,
              resumeFrom: state.resumeFrom,
              reconnectAttempts: state.reconnectAttempts,
              freshRetryAttempts: state.freshRetryAttempts,
              explicitResume,
              shouldResume,
            },
          ),
      })

      return 'stop'
    }
    if (
      !mayRestartFreshAfterStreamError({
        explicitResume,
        toolExecutionMayHaveStarted: state.toolExecutionMayHaveStarted,
      })
    ) {
      // Replaying from message zero could repeat a side effect, but that only
      // rules out a fresh start — not continuing. An error frame ends one
      // transport attempt; the AgentRun behind it keeps producing frames until
      // finishAgentRun(), which is why reporting a failed turn here shows a red
      // error above an answer that is still streaming in. Re-attach at
      // resumeFrom instead of replaying, and let startChat's reconnect ladder
      // handle the backoff.
      throw new Error(freshRetryReason ?? 'Agent stream emitted an error frame')
    }
    // Mid-stream failure. Drop the partial assistant turn in the
    // renderer, back off briefly to avoid hammering, then restart the
    // request from scratch. Same streamId is reused — the dead run's
    // ownership lease will TTL out, and the renderer keys tabs by it.
    const delay = Math.min(
      CHAT_STREAM_FRESH_RETRY_MAX_MS,
      CHAT_STREAM_FRESH_RETRY_BASE_MS * 2 ** (state.freshRetryAttempts - 1),
    )

    console.warn('[agent] chat stream broke mid-response; restarting fresh', {
      streamId,
      sessionId,
      attempt: state.freshRetryAttempts,
      reason: freshRetryReason,
      delay,
    })
    emit({ type: 'reset-partial' })
    state.forceFreshStart = true
    state.resumeFrom = 0
    state.reconnectAttempts = 0
    state.usedFreshStartFallback = false
    state.terminalEventDetected = false
    try {
      await abortableSleep(delay, ctx.signal)
    } catch {
      // User aborted during the backoff sleep.
      state.aborted = true
      emit({ type: 'aborted' })

      return 'stop'
    }

    return 'retry'
  }
  if (state.terminalEventDetected) {
    state.completedSuccessfully = true
    traceStream(
      'stream_completed',
      { streamId, sessionId },
      {
        elapsed_ms: Date.now() - turnStartedAtMs,
        reconnect_attempts: state.reconnectAttempts,
        resume_from: state.resumeFrom,
      },
    )

    return 'completed'
  }
  traceStream(
    'stream_ended_without_terminal_event',
    { streamId, sessionId },
    {
      elapsed_ms: Date.now() - turnStartedAtMs,
      reconnect_attempts: state.reconnectAttempts,
      resume_from: state.resumeFrom,
      first_frame_seen: firstFrameSeen,
    },
    'warn',
  )
  throw new Error(
    formatAgentLocalError('Agent stream ended before atlas-turn-complete.', {
      phase: 'missing_terminal_event',
      streamId,
      sessionId,
      teamId,
      resumeFrom: state.resumeFrom,
      reconnectAttempts: state.reconnectAttempts,
      freshRetryAttempts: state.freshRetryAttempts,
      explicitResume,
      shouldResume:
        !state.forceFreshStart &&
        (explicitResume || state.reconnectAttempts > 0 || state.resumeFrom > 0),
    }),
  )
}
