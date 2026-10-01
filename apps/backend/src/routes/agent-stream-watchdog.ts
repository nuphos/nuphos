// Pure classification logic for the agent model-stream silence watchdog. Kept
// dependency-free (no config/DB imports) so it can be unit-tested in isolation —
// importing the full agent route requires MONGODB_URI and friends. The concrete
// per-phase millisecond windows live in agent.ts (they depend on the bash tool
// timeout); this module only decides which phase a forwarded SSE frame implies.

// 'tool-execution' silence is a server-side tool running (the model isn't being
// awaited), so its timeout is a wedged-tool backstop rather than model-silence.
// 'tool-input' is the model streaming a committed tool call's arguments — slower
// and far costlier to abort than free-form 'generating' output.
// 'reasoning' is extended thinking: with summarized display the wire carries
// only the summarizer's bursts, so silence between bursts is the normal state
// and proves nothing about liveness — its window is a backstop, not a stall
// detector.
export type StreamStallPhase =
  'tool-execution' | 'tool-input' | 'reasoning' | 'generating' | 'awaiting-model'

export function parseSseDataPayload(raw: string): Record<string, unknown> | null {
  const dataLines: string[] = []

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return null
  const data = dataLines.join('\n')

  if (!data || data === '[DONE]') return null
  try {
    const parsed = JSON.parse(data)

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export type StallWindows = Record<StreamStallPhase, number>

export type StallTimeoutInfo = {
  phase: StreamStallPhase
  windowMs: number
  readWaitMs: number
}

// The tiered-silence state machine the pump runs every model stream through:
// each forwarded frame re-derives the phase, and each read of the raw stream
// races the current phase's window. Extracted from pumpAgentResponseToRun so
// the TIMING behavior (which silence gets how long before the turn is aborted)
// is unit-testable — the thinking regression shipped because only the
// classification was testable, not the window it bought.
export class SseStallWatchdog {
  phase: StreamStallPhase = 'awaiting-model'

  constructor(private readonly windows: StallWindows) {}

  get windowMs(): number {
    return this.windows[this.phase]
  }

  // Re-derive the phase from a forwarded frame's payload. Frames with no
  // stream-state signal leave the phase unchanged.
  observePayload(payload: Record<string, unknown> | null): void {
    const next = stallPhaseForPayload(payload)

    if (next) this.phase = next
  }

  // Race a read against the current phase's silence window. The window is
  // sampled at call time, so a frame observed between reads changes how long
  // the NEXT silence may last.
  async read<T>(
    read: () => Promise<T>,
    buildTimeout: (info: StallTimeoutInfo) => Error,
  ): Promise<T> {
    const readStartedAt = Date.now()
    const windowMs = this.windowMs
    let timeout: ReturnType<typeof setTimeout> | undefined

    try {
      return await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(
              buildTimeout({
                phase: this.phase,
                windowMs,
                readWaitMs: Date.now() - readStartedAt,
              }),
            )
          }, windowMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}

// The stall phase implied by an already-parsed frame payload, or null when the
// frame says nothing about stream state (caller keeps the current phase).
export function stallPhaseForPayload(
  payload: Record<string, unknown> | null,
): StreamStallPhase | null {
  const type = payload && typeof payload.type === 'string' ? payload.type : ''

  if (!type) return null
  if (type === 'tool-input-available') return 'tool-execution'
  // The model committed to a tool call and is streaming its args; gaps here are
  // legitimately longer than free-text generation and aborting strands a half-
  // emitted tool call, so this gets its own generous window.
  if (type === 'tool-input-start' || type === 'tool-input-delta') return 'tool-input'
  // Extended thinking. Summarized display (the only mode Opus 4.8 streams at
  // all) flushes reasoning in bursts: the model burns raw thinking tokens that
  // never reach the wire, then the summarizer emits a chunk. 10s+ gaps between
  // chunks are routine (prod: nearly every silence pause was
  // last_frame_type=reasoning-delta at exactly the generating window), and
  // aborting discards the whole thinking segment — reasoning is not replayed on
  // resume, so the retry re-thinks from scratch and hits the same gap (the
  // interrupt/restart loop users reported).
  if (type === 'reasoning-start' || type === 'reasoning-delta') return 'reasoning'
  if (type === 'text-start' || type === 'text-delta') return 'generating'

  // step boundaries, tool-output, etc. → next silence is the model's TTFT
  return 'awaiting-model'
}

// The stall phase implied by the last forwarded frame, or null when the frame
// says nothing about stream state (caller keeps the current phase).
export function stallPhaseForFrame(raw: string): StreamStallPhase | null {
  return stallPhaseForPayload(parseSseDataPayload(raw))
}

// The tool a frame is about, when it carries that identity. `toolName` only
// rides on tool-input-start / tool-input-available; `toolCallId` is on every
// tool-* frame. Used to name the stalled tool in the diagnostic chain so the
// client can say "stalled while streaming the input for `bash`" instead of a
// bare "interrupted".
export function toolIdentityFromPayload(
  payload: Record<string, unknown> | null,
): { toolName?: string; toolCallId?: string } | null {
  const type = payload && typeof payload.type === 'string' ? payload.type : ''

  if (!type.startsWith('tool-')) return null
  const identity: { toolName?: string; toolCallId?: string } = {}

  if (payload && typeof payload.toolName === 'string') identity.toolName = payload.toolName
  if (payload && typeof payload.toolCallId === 'string') identity.toolCallId = payload.toolCallId

  return identity.toolName || identity.toolCallId ? identity : null
}

/**
 * Whether a run has outrun its wall-clock deadline.
 *
 * Absolute, not idle-based, and that is the whole point: the stall watchdogs
 * above all reset on activity, so a turn that keeps making *successful* tool
 * calls never trips them. Headless surfaces carry a deadline because nobody on
 * the other end can press Stop; in-app runs pass `undefined` and are never cut
 * off here.
 */
export function turnDeadlineExceeded(deadlineAt: number | undefined, now: number): boolean {
  return deadlineAt !== undefined && now > deadlineAt
}

/**
 * Whether the pump should still emit its terminal frames (`atlas-turn-complete`
 * / `atlas-turn-paused` / `done`) after the response stream ends.
 *
 * A turn the SERVER ended must always say why — that is the whole contract the
 * paused frame exists to satisfy. Only a user abort ends silently, because the
 * user already knows: they pressed Stop.
 *
 * `forcedPauseReason` is in the predicate as a backstop, not as decoration. Any
 * pause path that aborts the run without also setting `watchdogTriggered` would
 * otherwise fall through to a generic failure and swallow its own reason —
 * which is exactly what the headless turn deadline did on first implementation.
 */
export function shouldEmitTerminalFrames(args: {
  aborted: boolean
  watchdogTriggered: boolean
  forcedPauseReason: string | undefined
}): boolean {
  return !args.aborted || args.watchdogTriggered || args.forcedPauseReason !== undefined
}
