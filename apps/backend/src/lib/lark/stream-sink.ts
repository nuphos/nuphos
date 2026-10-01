import { buildAgentCard } from '@/lib/lark/card'
import {
  CARDLESS_TOOLS,
  labelOf,
  outputIsError,
  PLAN_STEP_ID,
  REASONING_STEP_ID,
  safeStepDetail,
  textDelta,
} from '@/lib/lark/stream-sink-frames'
import { logEvent } from '@/lib/observability'
import { parseSseDataPayload } from '@/routes/agent-stream-watchdog'

import type { LarkCardState, LarkStep } from '@/lib/lark/card'
import type { LarkCardStream } from '@/lib/lark/stream'

// Translates an AgentRun's SSE frames into one streamed Lark card:
//   text-start/delta/end        → the card body (blocks separated by a blank line)
//   reasoning-start/delta/end    → a "思考中" step whose detail carries a tail of
//                                  the reasoning text
//   tool-input-available         → an in_progress step titled by the call's label
//   tool-output-available/error  → the same step flipped to complete/error
//   atlas-turn-complete/paused/error → terminal state for the route to inspect
//
// The model never posts to Lark directly — its visible text IS the reply, and
// the step list is a backend-derived timeline. Frames arrive synchronously from
// the run's subscriber poke; frame() only mutates state and asks the throttled
// LarkCardStream to re-render, so a Lark failure can never break the poke loop.

export type LarkRunTerminal = 'complete' | 'paused' | 'error'

export class LarkAgentRunSink {
  private queue: Promise<void> = Promise.resolve()
  // `body` is every text block joined — shown WHILE streaming so the user sees
  // the agent's progress narration. `lastBlock` is only the most recent text
  // segment (reset at each text-start); the FINISHED card keeps just that, so
  // interim narration ("let me check…") drops away and only the final answer
  // remains.
  private body = ''
  private lastBlock = ''
  private sawBody = false
  private pendingSeparator = false
  private steps: LarkStep[] = []
  // toolCallId / reasoning key → index into `steps`.
  private stepIndex = new Map<string, number>()
  private terminalState: LarkRunTerminal | null = null
  private finalized = false

  constructor(
    private readonly stream: LarkCardStream,
    private readonly sessionId: string,
  ) {}

  // Post an immediate "running" card (empty body → "正在思考…") so the user gets
  // instant feedback the moment their message is picked up, instead of ~silence
  // until the agent's first output frame arrives.
  begin(): void {
    this.enqueue(() => {
      this.rerender()
    })
  }

  frame(raw: string): void {
    const payload = parseSseDataPayload(raw)

    if (!payload || typeof payload.type !== 'string') return
    const type = payload.type

    this.enqueue(async () => {
      // A frame after finalize means the turn was handed off to a new run
      // (blocking decision); the card must close again once that run ends.
      this.finalized = false
      switch (type) {
        case 'text-start':
          if (this.sawBody) this.pendingSeparator = true
          // A new text segment begins — the final answer is only the last one.
          this.lastBlock = ''

          return
        case 'text-delta': {
          const delta = textDelta(payload)

          if (!delta) return
          if (this.pendingSeparator) {
            this.body += '\n\n'
            this.pendingSeparator = false
          }
          this.body += delta
          this.lastBlock += delta
          this.sawBody = true
          this.rerender()

          return
        }
        // Reasoning is the model's private chain-of-thought; on a shared card we
        // only show that it is thinking, never the text itself.
        case 'reasoning-start':
          this.upsertStep(REASONING_STEP_ID, { title: 'Thinking', status: 'in_progress' })
          this.rerender()

          return
        case 'reasoning-delta':
          return
        case 'reasoning-end':
          this.upsertStep(REASONING_STEP_ID, { title: 'Thinking', status: 'complete' })
          this.rerender()

          return
        case 'tool-input-available': {
          const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : null
          const toolName = typeof payload.toolName === 'string' ? payload.toolName : ''

          if (!toolCallId || !toolName || CARDLESS_TOOLS.has(toolName)) return
          const label = labelOf(payload.input)
          const key = toolName.startsWith('plan_') ? PLAN_STEP_ID : toolCallId

          // Title is the model-authored label (safe); raw input is never rendered.
          this.stepIndex.set(
            toolCallId,
            this.upsertStep(key, {
              title: label ?? toolName,
              status: 'in_progress',
            }),
          )
          this.rerender()

          return
        }
        case 'tool-output-available':
        case 'tool-output-error': {
          const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : null

          if (!toolCallId) return
          const idx = this.stepIndex.get(toolCallId)

          if (idx === undefined) return
          const step = this.steps[idx]

          if (!step) return
          const isError = type === 'tool-output-error' || outputIsError(payload.output)
          const errorText = typeof payload.errorText === 'string' ? payload.errorText : undefined

          step.status = isError ? 'error' : 'complete'
          const detail = isError && errorText ? errorText : safeStepDetail(payload.output)

          if (detail) step.detail = detail
          this.rerender()

          return
        }
        case 'atlas-turn-complete':
          this.terminalState = 'complete'

          return
        case 'atlas-turn-paused':
          this.terminalState = 'paused'
          this.closeOpenSteps('error')

          return
        case 'error':
          this.terminalState = 'error'
          this.closeOpenSteps('error')

          return
        default:
          return
      }
    })
  }

  done(): void {
    this.enqueue(() => this.finalize())
  }

  async settle(): Promise<void> {
    this.enqueue(() => this.finalize())
    await this.queue
  }

  // Force the terminal state to error when the run threw a JS exception before
  // (or instead of) an SSE `error` frame, so the finalized card renders red
  // rather than a misleading green "done". Enqueued so it lands in order AFTER
  // any already-queued frames (e.g. a stray atlas-turn-complete can't overwrite
  // it back to 'done'), and unconditional so an earlier 'complete' is overridden;
  // also flips any still-open steps to error.
  markFailed(): void {
    this.enqueue(() => {
      this.terminalState = 'error'
      this.closeOpenSteps('error')
    })
  }

  hasVisibleOutput(): boolean {
    return this.stream.hasVisibleOutput()
  }

  terminal(): LarkRunTerminal | null {
    return this.terminalState
  }

  private enqueue(fn: () => Promise<void> | void): void {
    this.queue = this.queue.then(fn, fn).catch((err: unknown) => {
      logEvent('warn', 'lark.sink.enqueue_error', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  // Insert or update a step by key; returns its index in `steps`.
  private upsertStep(key: string, patch: Omit<LarkStep, 'id'>): number {
    const existing = this.stepIndex.get(key)

    if (existing !== undefined && this.steps[existing]) {
      this.steps[existing] = { id: key, ...patch }

      return existing
    }
    const idx = this.steps.length

    this.steps.push({ id: key, ...patch })
    this.stepIndex.set(key, idx)

    return idx
  }

  private closeOpenSteps(status: LarkStep['status']): void {
    let changed = false

    for (const step of this.steps) {
      if (step.status === 'in_progress') {
        step.status = status
        changed = true
      }
    }
    if (changed) this.rerender()
  }

  // While running, show the full running narration; once finished, keep only the
  // last text segment (the final answer), falling back to the full body if there
  // was only ever one block.
  private finalBody(): string {
    return this.lastBlock.trim() || this.body.trim()
  }

  private state(phase: LarkCardState['phase']): LarkCardState {
    return {
      body: phase === 'running' ? this.body : this.finalBody(),
      steps: this.steps,
      phase,
      ...(phase !== 'running' ? { sessionId: this.sessionId } : {}),
    }
  }

  private rerender(): void {
    this.stream.render(buildAgentCard(this.state('running')))
  }

  private async finalize(): Promise<void> {
    // done() and settle() (and the caller's error-path settle()) all enqueue
    // finalize; run it once so the final card PATCH + fallback aren't duplicated.
    if (this.finalized) return
    this.finalized = true
    const phase = this.terminalState === 'error' ? 'error' : 'done'

    await this.stream.finalize(buildAgentCard(this.state(phase)))
    // The card path never opened, OR it opened but a later PATCH failed (so it
    // shows stale content): deliver the final body as a fresh fallback message
    // so the answer is never lost.
    if (this.finalBody() && (!this.stream.hasVisibleOutput() || this.stream.isDegraded())) {
      await this.stream.fallbackText(this.finalBody())
    }
  }
}
