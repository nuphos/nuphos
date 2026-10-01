import { logEvent } from '@/lib/observability'
import {
  CARDLESS_TOOLS,
  REASONING_STATUS,
  REPLY_TAIL_CHARS,
  clampStatusText,
  labelFromToolInput,
  splitSlackText,
  textDeltaFromPayload,
} from '@/lib/slack/stream-sink/helpers'
import { parseSseDataPayload } from '@/routes/agent-stream-watchdog'

import type { SlackRunTerminal } from '@/lib/slack/stream-sink/helpers'

export { splitSlackText } from '@/lib/slack/stream-sink/helpers'
export type { SlackRunTerminal } from '@/lib/slack/stream-sink/helpers'

// Posts one Slack thread reply. Success = resolved promise; a rejection is
// logged and the chunk is dropped (Slack delivery is best-effort by contract).
export type SlackUtterancePoster = (text: string) => Promise<unknown>
export type SlackToolApprovalPoster = (request: Record<string, unknown>) => Promise<unknown>

// Translates an AgentRun's SSE frames into plain Slack thread replies, pacing
// them the way a person uses Slack: say something, go do the work, come back
// and say the next thing. Nothing is streamed and nothing is edited after the
// fact. Text buffers into the current utterance; a tool call means the agent
// is heading into work, so the utterance posts right then (not at the end of
// the turn) and the transient status line shows the tool's label. Reasoning
// shows "Thinking" on the same status line; the closing utterance posts at
// settle().
//
// The model never drives Slack output directly — its visible text IS the
// Slack reply, and the status line is a backend-derived transient that leaves
// nothing behind in the thread. Frames arrive synchronously from the run's
// subscriber poke, so frame() only enqueues; all Slack I/O runs on a serial
// queue.
export class SlackAgentRunSink {
  // Serializes all Slack I/O triggered by frames; frame() itself stays sync.
  private queue: Promise<void> = Promise.resolve()
  // The utterance being written: everything said since the last posted
  // message.
  private pendingText = ''
  // Rolling tail of everything the model said this turn (see replyTail()).
  private replyText = ''
  // The model's text arrives as separate blocks; consecutive blocks within one
  // utterance are joined with a blank line. text-start arms the separator; the
  // next non-empty delta pays it, so empty text blocks never inject stray
  // blank lines.
  private sawBodyText = false
  private pendingSeparator = false
  private lastStatus = ''
  private postedAnything = false
  private terminalState: SlackRunTerminal | null = null
  private readonly toolLabels = new Map<string, string>()

  constructor(
    private readonly post: SlackUtterancePoster,
    // Drives assistant.threads.setStatus. Cosmetic and fire-and-forget: a
    // status update must never delay or fail a turn.
    private readonly onStatus?: (text: string) => void,
    // ACP tool approvals are live, blocking decisions. Slack must publish the
    // card while the turn is still running; waiting until settle() means the
    // turn can never settle because the runtime is waiting for that decision.
    private readonly onToolApprovalRequest?: SlackToolApprovalPoster,
  ) {}

  // Receives one raw SSE frame from the run subscriber. Synchronous and
  // non-throwing by contract: the run's poke loop must never be broken by a
  // Slack failure.
  frame(raw: string): void {
    const payload = parseSseDataPayload(raw)

    if (!payload || typeof payload.type !== 'string') return
    const type = payload.type

    this.enqueue(async () => {
      switch (type) {
        case 'text-start': {
          if (this.sawBodyText) this.pendingSeparator = true

          return
        }
        case 'text-delta': {
          const delta = textDeltaFromPayload(payload)

          if (!delta) return
          if (this.pendingSeparator) {
            this.pendingText += '\n\n'
            this.pendingSeparator = false
          }
          this.pendingText += delta
          this.replyText = `${this.replyText}${delta}`.slice(-REPLY_TAIL_CHARS)
          this.sawBodyText = true

          return
        }
        case 'reasoning-start':
          this.pushStatus(REASONING_STATUS)

          return
        case 'tool-input-available':
          await this.handleToolStart(payload)

          return
        case 'tool-approval-request':
          await this.handleToolApprovalRequest(payload)

          return
        case 'atlas-turn-complete':
          this.terminalState = 'complete'

          return
        case 'atlas-turn-paused':
          this.terminalState = 'paused'

          return
        case 'error':
          this.terminalState = 'error'

          return
        default:
          return
      }
    })
  }

  // The run appended its terminal frame; post whatever is still buffered.
  done(): void {
    this.enqueue(() => this.postUtterance())
  }

  // Awaits the serial queue after the run has finished, guaranteeing every
  // frame's Slack effect (including the closing utterance) has landed.
  // Idempotent with done(): posting an empty buffer is a no-op.
  async settle(): Promise<void> {
    this.enqueue(() => this.postUtterance())
    await this.queue
  }

  // Delivers a line the route (not the model) needs to say — a pause notice,
  // an error. Rides the queue so it lands after whatever was said last.
  async say(text: string): Promise<void> {
    this.enqueue(() => this.deliver(text))
    await this.queue
  }

  // Whether this turn produced anything the user can see in the thread —
  // used to decide if the reply deserves follow-up affordances.
  hasVisibleOutput(): boolean {
    return this.postedAnything
  }

  terminal(): SlackRunTerminal | null {
    return this.terminalState
  }

  // The tail of what the agent actually said this turn, for the thread's
  // rolling transcript (lib/slack/agent-bot.ts). The addressing judge reads it
  // to tell an un-mentioned follow-up to the agent from teammates talking to
  // each other, and the closing words are what a follow-up follows on from.
  replyTail(): string {
    return this.replyText.trim()
  }

  private async handleToolStart(payload: Record<string, unknown>): Promise<void> {
    const toolName = typeof payload.toolName === 'string' ? payload.toolName : ''
    const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : ''
    const label = labelFromToolInput(payload.input) ?? toolName

    if (toolCallId && label) this.toolLabels.set(toolCallId, label)

    if (!toolName || CARDLESS_TOOLS.has(toolName)) return
    await this.postUtterance()
    this.pushStatus(label)
  }

  private async handleToolApprovalRequest(payload: Record<string, unknown>): Promise<void> {
    if (!this.onToolApprovalRequest) return
    const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : ''

    await this.postUtterance()
    this.pushStatus('Waiting for approval')
    await this.onToolApprovalRequest({
      ...payload,
      ...(toolCallId && this.toolLabels.has(toolCallId)
        ? { toolLabel: this.toolLabels.get(toolCallId) }
        : {}),
    })
  }

  // Posts the buffered utterance as its own thread reply (split only when it
  // exceeds Slack's per-message ceiling) and resets for the next one.
  private async postUtterance(): Promise<void> {
    const text = this.pendingText.trim()

    this.pendingText = ''
    this.sawBodyText = false
    this.pendingSeparator = false
    if (!text) return
    await this.deliver(text)
  }

  private async deliver(text: string): Promise<void> {
    for (const chunk of splitSlackText(text)) {
      try {
        await this.post(chunk)
        this.postedAnything = true
      } catch (err) {
        logEvent('warn', 'slack.sink.post_error', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  private pushStatus(text: string): void {
    const line = clampStatusText(text)

    if (!line || line === this.lastStatus) return
    this.lastStatus = line
    this.onStatus?.(line)
  }

  private enqueue(fn: () => Promise<void>): void {
    this.queue = this.queue.then(fn, fn).catch((err: unknown) => {
      // deliver() handles and logs its own post failures, so a rejection
      // reaching here is an unexpected sink-side bug. Swallow it — the run's
      // synchronous poke loop must never break — but leave a breadcrumb
      // instead of dropping it silently.
      logEvent('warn', 'slack.sink.enqueue_error', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }
}
