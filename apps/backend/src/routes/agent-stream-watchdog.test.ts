import { describe, expect, test } from 'bun:test'

import {
  parseSseDataPayload,
  SseStallWatchdog,
  stallPhaseForFrame,
  shouldEmitTerminalFrames,
  toolIdentityFromPayload,
  turnDeadlineExceeded,
} from './agent-stream-watchdog'

import type { StallWindows, StreamStallPhase } from './agent-stream-watchdog'

const frame = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}`

describe('stallPhaseForFrame', () => {
  test('tool-call argument streaming gets the generous tool-input phase', () => {
    // Regression guard: these used to map to the 10s 'generating' window, so a
    // Bedrock gap while the model streamed a tool call's args aborted the turn
    // on a half-emitted tool call (chip stuck on "Preparing command…"). They
    // must now land in 'tool-input', which agent.ts budgets at 60s.
    expect(stallPhaseForFrame(frame({ type: 'tool-input-start', toolName: 'bash' }))).toBe(
      'tool-input' satisfies StreamStallPhase,
    )
    expect(stallPhaseForFrame(frame({ type: 'tool-input-delta', inputTextDelta: 'kubectl' }))).toBe(
      'tool-input' satisfies StreamStallPhase,
    )
  })

  test('completed tool input (server-side execution) is tool-execution', () => {
    expect(
      stallPhaseForFrame(frame({ type: 'tool-input-available', toolName: 'bash', input: {} })),
    ).toBe('tool-execution' satisfies StreamStallPhase)
  })

  test('free-form text deltas stay in the tight generating window', () => {
    expect(stallPhaseForFrame(frame({ type: 'text-start' }))).toBe('generating')
    expect(stallPhaseForFrame(frame({ type: 'text-delta', delta: 'hi' }))).toBe('generating')
  })

  test('extended-thinking reasoning gets its own backstop phase', () => {
    // Regression guard: these used to map to the 10s 'generating' window, but
    // summarized-display reasoning legitimately gaps 10s+ between summary
    // bursts, so the watchdog aborted nearly every long thinking segment and
    // the resume re-thought from scratch into the same abort.
    expect(stallPhaseForFrame(frame({ type: 'reasoning-start' }))).toBe(
      'reasoning' satisfies StreamStallPhase,
    )
    expect(stallPhaseForFrame(frame({ type: 'reasoning-delta', delta: '...' }))).toBe(
      'reasoning' satisfies StreamStallPhase,
    )
    // reasoning-end is a boundary: the next silence is the model's TTFT again
    expect(stallPhaseForFrame(frame({ type: 'reasoning-end' }))).toBe('awaiting-model')
  })

  test('step boundaries and tool output fall back to awaiting-model (TTFT)', () => {
    expect(stallPhaseForFrame(frame({ type: 'tool-output-available', output: {} }))).toBe(
      'awaiting-model',
    )
    expect(stallPhaseForFrame(frame({ type: 'start-step' }))).toBe('awaiting-model')
    expect(stallPhaseForFrame(frame({ type: 'finish-step' }))).toBe('awaiting-model')
  })

  test('frames with no stream-state signal return null so the caller keeps the phase', () => {
    expect(stallPhaseForFrame(': atlas-heartbeat')).toBeNull()
    expect(stallPhaseForFrame('data: [DONE]')).toBeNull()
    expect(stallPhaseForFrame('data: not-json')).toBeNull()
    expect(stallPhaseForFrame(frame({ noType: true }))).toBeNull()
  })
})

// Timing replay of the prod incident, scaled 5ms : 1s so the suite stays fast.
// Prod trace (Braintrust, agent.chat.pump.model_stream_
// silence_paused): thinking enabled → summarized reasoning flushes in bursts →
// a 10s+ wire gap mid-reasoning → watchdog aborts with stall_phase=generating,
// last_frame_type=reasoning-delta, no_frame_ms≈10000 → resume re-thinks from
// scratch into the same gap (4+ pauses in 2 minutes). These tests drive the
// SAME SseStallWatchdog the pump uses, so they prove the timing, not just the
// frame classification.
describe('SseStallWatchdog timing (5ms = 1s of prod)', () => {
  const SCALED_PROD_WINDOWS: StallWindows = {
    generating: 50, // 10s
    reasoning: 900, // 180s
    'tool-input': 300, // 60s
    'awaiting-model': 300, // 60s
    'tool-execution': 750, // 150s
  }
  // What prod effectively ran before the fix: reasoning frames landed in the
  // 'generating' bucket, so a reasoning silence only got the 10s window.
  const PRE_FIX_WINDOWS: StallWindows = {
    ...SCALED_PROD_WINDOWS,
    reasoning: SCALED_PROD_WINDOWS.generating,
  }
  const THINKING_GAP_MS = 75 // a routine "15s" summarizer gap mid-thinking

  const chunkAfter = (ms: number) => () =>
    new Promise<string>((resolve) => setTimeout(() => resolve('chunk'), ms))
  const neverResolves = () => new Promise<string>(() => {})
  const timeoutError = (info: { phase: string; windowMs: number }) =>
    new Error(`silence-timeout phase=${info.phase} window=${String(info.windowMs)}`)

  test('REPRO: a routine thinking gap dies inside the pre-fix window layout', async () => {
    const watchdog = new SseStallWatchdog(PRE_FIX_WINDOWS)

    watchdog.observePayload({ type: 'reasoning-start' })
    watchdog.observePayload({ type: 'reasoning-delta', delta: 'summary burst' })
    // Summarized display goes quiet while raw thinking burns off-wire; the
    // next burst WOULD arrive, but the watchdog kills the read first — this
    // is the prod abort (no_frame_ms pinned at exactly the 10s window).
    await expect(watchdog.read(chunkAfter(THINKING_GAP_MS), timeoutError)).rejects.toThrow(
      'silence-timeout phase=reasoning window=50',
    )
  })

  test('FIX: the same thinking gap survives the dedicated reasoning window', async () => {
    const watchdog = new SseStallWatchdog(SCALED_PROD_WINDOWS)

    watchdog.observePayload({ type: 'reasoning-start' })
    watchdog.observePayload({ type: 'reasoning-delta', delta: 'summary burst' })
    await expect(watchdog.read(chunkAfter(THINKING_GAP_MS), timeoutError)).resolves.toBe('chunk')
  })

  test('FIX does not loosen text generation: the same gap after a text-delta still aborts', async () => {
    const watchdog = new SseStallWatchdog(SCALED_PROD_WINDOWS)

    watchdog.observePayload({ type: 'reasoning-delta', delta: 'summary burst' })
    watchdog.observePayload({ type: 'text-delta', delta: 'answer' })
    await expect(watchdog.read(chunkAfter(THINKING_GAP_MS), timeoutError)).rejects.toThrow(
      'silence-timeout phase=generating window=50',
    )
  })

  test('FIX keeps a backstop: a genuinely dead stream mid-reasoning still times out', async () => {
    const watchdog = new SseStallWatchdog(SCALED_PROD_WINDOWS)

    watchdog.observePayload({ type: 'reasoning-delta', delta: 'summary burst' })
    await expect(watchdog.read(neverResolves, timeoutError)).rejects.toThrow(
      'silence-timeout phase=reasoning window=900',
    )
  })
})

describe('parseSseDataPayload', () => {
  test('reassembles a multi-line data frame (large tool input split across lines)', () => {
    const raw = 'data: {"type":"tool-input-available",\ndata: "input":{"command":"echo hi"}}'

    expect(parseSseDataPayload(raw)).toEqual({
      type: 'tool-input-available',
      input: { command: 'echo hi' },
    })
  })

  test('ignores comment/heartbeat lines and [DONE] sentinels', () => {
    expect(parseSseDataPayload(': atlas-heartbeat')).toBeNull()
    expect(parseSseDataPayload('data: [DONE]')).toBeNull()
  })
})

describe('toolIdentityFromPayload', () => {
  test('captures toolName + toolCallId from tool frames', () => {
    expect(
      toolIdentityFromPayload({ type: 'tool-input-start', toolName: 'bash', toolCallId: 'abc' }),
    ).toEqual({ toolName: 'bash', toolCallId: 'abc' })
    // deltas carry only the call id — used to keep tracking the same tool
    expect(toolIdentityFromPayload({ type: 'tool-input-delta', toolCallId: 'abc' })).toEqual({
      toolCallId: 'abc',
    })
  })

  test('returns null for non-tool frames or tool frames with no identity', () => {
    expect(toolIdentityFromPayload({ type: 'text-delta', delta: 'hi' })).toBeNull()
    expect(toolIdentityFromPayload({ type: 'tool-input-start' })).toBeNull()
    expect(toolIdentityFromPayload(null)).toBeNull()
  })
})

describe('turnDeadlineExceeded', () => {
  const start = 1_000_000
  const deadline = start + 45 * 60 * 1000

  test('an in-app run has no deadline and is never cut off here', () => {
    // The user can press Stop, so nothing else has to. A ceiling here would
    // re-create the failure the step cap caused: real work severed mid-flight.
    expect(turnDeadlineExceeded(undefined, start + 100 * 60 * 1000)).toBe(false)
  })

  test('a headless run inside its window keeps going', () => {
    expect(turnDeadlineExceeded(deadline, start)).toBe(false)
    expect(turnDeadlineExceeded(deadline, deadline)).toBe(false)
  })

  test('a productive loop still trips it — activity does not reset the clock', () => {
    // The point of the whole thing. Every other guard resets on progress: the
    // stall watchdogs on any frame, runaway detection on a tool that stops
    // failing. A turn that keeps making SUCCESSFUL tool calls satisfies all of
    // them forever, so the only bound left has to be absolute.
    let now = start

    // 5s per call over the 45-minute window is ~540 calls; 600 clears it.
    for (let toolCall = 0; toolCall < 600; toolCall += 1) {
      now += 5_000 // a steady stream of successful calls, five seconds apart
      if (turnDeadlineExceeded(deadline, now)) break
    }
    expect(turnDeadlineExceeded(deadline, now)).toBe(true)
    expect(now).toBeGreaterThan(deadline)
  })
})

describe('shouldEmitTerminalFrames', () => {
  test('a stream that ended on its own always reports', () => {
    expect(
      shouldEmitTerminalFrames({
        aborted: false,
        watchdogTriggered: false,
        forcedPauseReason: undefined,
      }),
    ).toBe(true)
  })

  test('a user abort ends silently — they pressed Stop, they know why', () => {
    expect(
      shouldEmitTerminalFrames({
        aborted: true,
        watchdogTriggered: false,
        forcedPauseReason: undefined,
      }),
    ).toBe(false)
  })

  test('a watchdog abort still reports', () => {
    expect(
      shouldEmitTerminalFrames({
        aborted: true,
        watchdogTriggered: true,
        forcedPauseReason: 'model-silence',
      }),
    ).toBe(true)
  })

  // Regression guard. The headless turn deadline shipped setting only
  // forcedPauseReason, so the gate closed on its own abort and the turn died
  // with a generic failure instead of the reason it had just named — the exact
  // "stopped without saying why" behaviour the deadline exists to avoid.
  test('a pause that names a reason reports even if it forgot the watchdog flag', () => {
    expect(
      shouldEmitTerminalFrames({
        aborted: true,
        watchdogTriggered: false,
        forcedPauseReason: 'turn-deadline',
      }),
    ).toBe(true)
  })
})
