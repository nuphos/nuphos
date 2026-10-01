import { patchLarkCard, replyLarkMessage, sendLarkMessage } from '@/lib/lark/api'
import { logEvent } from '@/lib/observability'

import type { LarkAppContext } from '@/lib/lark/api'

// Owns ONE streamed interactive card: opens it lazily as a threaded reply to the
// triggering message, then coalesces PATCH updates so we never exceed Lark's
// 5 req/s per-message ceiling. All Lark I/O runs on a serial queue; render() is
// synchronous and non-throwing so the run's frame poke loop can never break.
const MIN_PATCH_INTERVAL_MS = 800

export class LarkCardStream {
  private queue: Promise<void> = Promise.resolve()
  private messageId: string | null = null
  private pendingCard: Record<string, unknown> | null = null
  private lastPatchAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private degraded = false
  private opened = false

  constructor(
    private readonly deps: {
      ctx: LarkAppContext
      chatId: string
      // The message the agent was mentioned in; the card replies to it.
      rootMessageId: string
      // Group @mentions reply into a Lark topic thread; 1:1 DMs reply inline
      // (a topic thread in a DM reads as broken).
      replyInThread: boolean
    },
  ) {}

  // Queue the latest card state for rendering. Only the most recent card matters
  // (a patch replaces the whole card), so we keep just the latest and flush on a
  // throttle.
  render(card: Record<string, unknown>): void {
    if (this.degraded) return
    this.pendingCard = card
    this.scheduleFlush()
  }

  // Flush immediately and wait for all I/O to settle. Used at end of turn.
  async finalize(card: Record<string, unknown>): Promise<void> {
    this.pendingCard = card
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.enqueue(() => this.flush())
    await this.queue
  }

  hasVisibleOutput(): boolean {
    return this.opened
  }

  // True once any IO failed. A PATCH failure after the card opened leaves it
  // showing stale content, so the sink still delivers the final body as a fresh
  // fallback message even though hasVisibleOutput() is true.
  isDegraded(): boolean {
    return this.degraded
  }

  // Last-resort: the card path failed entirely; deliver `text` as a plain
  // message so the answer still lands.
  async fallbackText(text: string): Promise<void> {
    if (!text.trim()) return
    this.enqueue(async () => {
      try {
        await sendLarkMessage({
          ctx: this.deps.ctx,
          receiveIdType: 'chat_id',
          receiveId: this.deps.chatId,
          msgType: 'text',
          content: JSON.stringify({ text }),
        })
        this.opened = true
      } catch (err) {
        logEvent('warn', 'lark.stream.fallback_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
    await this.queue
  }

  private scheduleFlush(): void {
    if (this.timer) return
    const wait = Math.max(0, MIN_PATCH_INTERVAL_MS - (Date.now() - this.lastPatchAt))

    this.timer = setTimeout(() => {
      this.timer = null
      this.enqueue(() => this.flush())
    }, wait)
    this.timer.unref?.()
  }

  private enqueue(fn: () => Promise<void>): void {
    this.queue = this.queue.then(fn, fn).catch((err: unknown) => {
      logEvent('warn', 'lark.stream.enqueue_error', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  private async flush(): Promise<void> {
    if (!this.pendingCard || this.degraded) return
    const card = this.pendingCard

    this.pendingCard = null
    this.lastPatchAt = Date.now()
    const content = JSON.stringify(card)

    try {
      if (!this.messageId) {
        const { messageId } = await replyLarkMessage({
          ctx: this.deps.ctx,
          messageId: this.deps.rootMessageId,
          msgType: 'interactive',
          content,
          replyInThread: this.deps.replyInThread,
        })

        this.messageId = messageId
        this.opened = true
        // Reply succeeded but returned no id (shouldn't happen) — can't patch,
        // so treat further updates as degraded.
        if (!this.messageId) this.degraded = true

        return
      }
      await patchLarkCard({ ctx: this.deps.ctx, messageId: this.messageId, content })
    } catch (err) {
      // Any IO failure degrades the card path; the sink delivers the final body
      // via fallbackText() at settle so the answer is never lost.
      this.degraded = true
      logEvent('warn', 'lark.stream.flush_failed', {
        opened: this.opened,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
