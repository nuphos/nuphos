import {
  SseStallWatchdog,
  parseSseDataPayload,
  toolIdentityFromPayload,
} from '../agent-stream-watchdog'

import {
  AgentStreamSilenceTimeout,
  HEADLESS_TURN_DEADLINE_MS,
  STALL_WINDOW_AWAITING_MODEL_MS,
  STALL_WINDOW_GENERATING_MS,
  STALL_WINDOW_REASONING_MS,
  STALL_WINDOW_TOOL_EXECUTION_MS,
  STALL_WINDOW_TOOL_INPUT_MS,
} from './constants'
import { isUiErrorFrame } from './frame-predicates'
import { appendAgentRunFrame } from './run-frames'
import { traceAgentChatError, traceAgentChatEvent, traceAgentChatSpanEvent } from './trace'

import type { StreamStallPhase } from '../agent-stream-watchdog'
import type { AgentRun } from './types'

export const STALL_PHASE_WINDOW_MS: Record<StreamStallPhase, number> = {
  'awaiting-model': STALL_WINDOW_AWAITING_MODEL_MS,
  generating: STALL_WINDOW_GENERATING_MS,
  reasoning: STALL_WINDOW_REASONING_MS,
  'tool-input': STALL_WINDOW_TOOL_INPUT_MS,
  'tool-execution': STALL_WINDOW_TOOL_EXECUTION_MS,
}

export type AgentRunOutcome = {
  status: 'completed' | 'paused' | 'failed'
  finishReason?: string
  pauseReason?: string
}

/** Per-pump mutable state shared between the read loop, the pause helpers,
 *  and the terminal-frame emitter. */
export type PumpState = {
  pumpStartedAt: number
  lastChunkAt: number
  lastFrameAt: number
  rawChunkCount: number
  rawBytes: number
  forwardedFrames: number
  forwardedBytes: number
  droppedAbortErrorFrames: number
  watchdogError: unknown
  forcedPauseReason: string | undefined
  stallWatchdog: SseStallWatchdog
  lastFrameType: string | undefined
  lastToolName: string | undefined
  lastToolCallId: string | undefined
  buffer: string
  sawPumpError: boolean
}

export function createPumpState(): PumpState {
  const pumpStartedAt = Date.now()

  return {
    pumpStartedAt,
    lastChunkAt: pumpStartedAt,
    lastFrameAt: pumpStartedAt,
    rawChunkCount: 0,
    rawBytes: 0,
    forwardedFrames: 0,
    forwardedBytes: 0,
    droppedAbortErrorFrames: 0,
    watchdogError: undefined,
    forcedPauseReason: undefined,
    stallWatchdog: new SseStallWatchdog(STALL_PHASE_WINDOW_MS),
    lastFrameType: undefined,
    lastToolName: undefined,
    lastToolCallId: undefined,
    buffer: '',
    sawPumpError: false,
  }
}

export function buildSilenceTimeout(
  run: AgentRun,
  state: PumpState,
  details: Record<string, unknown>,
): AgentStreamSilenceTimeout {
  const now = Date.now()

  return new AgentStreamSilenceTimeout({
    streamId: run.streamId,
    sessionId: run.trace?.sessionId,
    teamId: run.trace?.teamId,
    requestId: run.trace?.requestId,
    raw_chunk_count: state.rawChunkCount,
    raw_bytes: state.rawBytes,
    forwarded_frames: state.forwardedFrames,
    forwarded_bytes: state.forwardedBytes,
    buffered_bytes: state.buffer.length,
    dropped_abort_error_frames: state.droppedAbortErrorFrames,
    last_finish_reason: run.lastFinishReason,
    stall_timeout_ms: state.stallWatchdog.windowMs,
    no_chunk_ms: now - state.lastChunkAt,
    no_frame_ms: now - state.lastFrameAt,
    elapsed_ms: now - state.pumpStartedAt,
    ...details,
  })
}

// The cause chain attached to the atlas-turn-paused frame (and reused for the
// backend pause/abandon telemetry). Structured, not a sentence — the client
// renders the human-readable message from these fields.
export function buildPauseDetail(
  run: AgentRun,
  state: PumpState,
  reason: string,
): Record<string, unknown> {
  const now = Date.now()

  return {
    reason,
    streamId: run.streamId,
    stallPhase: state.stallWatchdog.phase,
    stallTimeoutMs: state.stallWatchdog.windowMs,
    noFrameMs: now - state.lastFrameAt,
    lastFrameType: state.lastFrameType ?? null,
    toolName: state.lastToolName ?? null,
    toolCallId: state.lastToolCallId ?? null,
    forwardedFrames: state.forwardedFrames,
    elapsedMs: now - state.pumpStartedAt,
    lastFinishReason: run.lastFinishReason ?? null,
    watchdogTriggered: state.watchdogError !== undefined,
  }
}

export async function pauseForTurnDeadline(
  run: AgentRun,
  state: PumpState,
  reader: Pick<ReadableStreamDefaultReader<Uint8Array>, 'cancel'>,
): Promise<void> {
  state.forcedPauseReason = 'turn-deadline'
  // Symmetric with pauseForSilenceTimeout: aborting without this leaves the
  // terminal-frame gate closed, and the turn dies without emitting the pause
  // reason it just went to the trouble of naming.
  const deadlineError = new Error(
    `Headless turn exceeded its ${String(HEADLESS_TURN_DEADLINE_MS)}ms deadline`,
  )

  deadlineError.name = 'AgentTurnDeadline'
  state.watchdogError = deadlineError
  traceAgentChatEvent('warn', 'agent.chat.pump.turn_deadline_reached', run.trace, {
    pause_reason: state.forcedPauseReason,
    deadline_ms: HEADLESS_TURN_DEADLINE_MS,
    elapsed_ms: Date.now() - run.createdAt,
    forwarded_frames: state.forwardedFrames,
    last_frame_type: state.lastFrameType ?? null,
    tool_name: state.lastToolName ?? null,
    recoverable: false,
  })
  run.abortController.abort()
  try {
    await reader.cancel(new Error('headless turn deadline reached'))
  } catch {
    // The reader is already torn down; the pause reason is what matters.
  }
}

export async function pauseForSilenceTimeout(
  run: AgentRun,
  state: PumpState,
  reader: Pick<ReadableStreamDefaultReader<Uint8Array>, 'cancel'>,
  err: AgentStreamSilenceTimeout,
): Promise<void> {
  state.watchdogError = err
  const toolBackstop = state.stallWatchdog.phase === 'tool-execution'

  state.forcedPauseReason = toolBackstop ? 'tool-execution-timeout' : 'model-silence'
  traceAgentChatSpanEvent(
    'warn',
    toolBackstop
      ? 'agent.chat.pump.tool_execution_backstop_paused'
      : 'agent.chat.pump.model_stream_silence_paused',
    run.trace,
    {
      ...err.details,
      pause_reason: state.forcedPauseReason,
      stall_phase: state.stallWatchdog.phase,
      last_frame_type: state.lastFrameType ?? null,
      tool_name: state.lastToolName ?? null,
      tool_call_id: state.lastToolCallId ?? null,
      recoverable: true,
    },
  )
  run.abortController.abort()
  try {
    await reader.cancel(err)
  } catch (cancelErr) {
    traceAgentChatError('agent.chat.pump.model_stream_cancel_failed', cancelErr, run.trace, {
      raw_chunk_count: state.rawChunkCount,
      forwarded_frames: state.forwardedFrames,
      elapsed_ms: Date.now() - state.pumpStartedAt,
    })
  }
}

export function forwardFrame(run: AgentRun, state: PumpState, raw: string): void {
  // AI SDK streamText emits an `error`-type UI frame when its abort signal fires
  // quickly (vercel/ai#8088). After user abort, drop those so the client doesn't
  // surface a spurious "AbortError" the user already initiated.
  if (run.abortController.signal.aborted && isUiErrorFrame(raw)) {
    state.droppedAbortErrorFrames += 1
    traceAgentChatEvent('warn', 'agent.chat.pump.abort_error_frame_dropped', run.trace, {
      raw_frame_bytes: raw.length,
      dropped_abort_error_frames: state.droppedAbortErrorFrames,
      frame_count: run.frames.length,
      elapsed_ms: Date.now() - state.pumpStartedAt,
    })

    return
  }
  appendAgentRunFrame(run, `${raw}\n\n`)
  state.forwardedFrames += 1
  state.forwardedBytes += raw.length
  state.lastFrameAt = Date.now()
  const payload = parseSseDataPayload(raw)

  if (payload && typeof payload.type === 'string') state.lastFrameType = payload.type
  const toolIdentity = toolIdentityFromPayload(payload)

  if (toolIdentity) {
    if (toolIdentity.toolName) state.lastToolName = toolIdentity.toolName
    if (toolIdentity.toolCallId) state.lastToolCallId = toolIdentity.toolCallId
  }
  state.stallWatchdog.observePayload(payload)
}
