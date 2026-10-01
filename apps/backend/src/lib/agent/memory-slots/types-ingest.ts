// SPI file-set member (see types.ts): post-turn ingest slot + webhook.
// Import discipline enforced by boundaries.test.ts rule (b).

import type { MemorySessionOrigin } from './types'
import type { MemorySavedEvent } from './types-events'

// --- Slot 3 — Ingest (post-turn write hook) ---------------------------------

export type ToolCallDigest = {
  id: string
  name: string
  /** JSON-encoded arguments, secrets already redacted by the runtime. */
  arguments: string
}

export type TurnMessageDigest =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCallDigest[] }
  | { role: 'tool'; toolCallId: string; content: string }

export type TurnDigest = {
  conversationId: string
  userId: string
  teamId: string | null
  origin: MemorySessionOrigin
  /** The full finished turn, tool calls included. Each provider decides what
   * to extract; a vendor wanting only the user/assistant pair reduces it
   * (old xtrace ingest shape). */
  messages: TurnMessageDigest[]
  planId: string | null
  startedAt: string // ISO 8601
  finishedAt: string // ISO 8601
  /** Labels recall already surfaced this turn, plus the one-line labels of
   * memories explicitly saved during the turn — the distiller's dedup hint
   * ("alreadyKnown"): a provider must not re-learn what the turn already knows,
   * whether it arrived via recall or via an explicit save. Populated by the
   * runtime dispatcher from the turn accumulator; absent
   * means "nothing was recalled or saved". */
  alreadyRecalled?: string[]
}

export type IngestOutcome = {
  /** What was learned. Empty array = zero-yield turn — the EXPECTED common
   * case (~38%); the runtime renders nothing (anti-noise rule). 'drafted'
   * actions render as pending-review cards. This doubles as the lifecycle-
   * fact channel: action:'updated'/'superseded' + supersededId feed the
   * runtime's supersede-correction signal. It is NOT effectiveness
   * self-report — the runtime uses it for the ingest SSE frame, the durable
   * ingest-event snapshot, the learned card, and the correction signal only. */
  saved: MemorySavedEvent[]
  /** 'pending' = async vendor still working (Zep episodes, xtrace jobs; A5③)
   * — distinct from zero-yield. Late results flow through the webhook slot +
   * observer. Absent means 'completed'. */
  status?: 'completed' | 'pending'
  /** Opaque provider diagnostics, logged verbatim; never branched on (A5③). */
  diagnostics?: Record<string, number | string | boolean>
}

export type TurnIngestor = {
  /** Fire-and-forget: dispatched after turn finalization, never awaited on the
   * hot path, must never throw into the turn (the runtime catches and logs
   * regardless). `signal` aborts at the ingest budget (default 30 000 ms).
   * The SSE stream may already be closed when this resolves: the runtime
   * emits "learned" frames only if the stream is still open, and durably
   * snapshots the outcome either way so GET /memories/ingest/:sessionId can
   * serve it. */
  onTurnFinished(digest: TurnDigest, opts: { signal: AbortSignal }): Promise<IngestOutcome | null>
}

/** Provider-inbound callback slot (A5③): gives vendor webhooks (e.g. xtrace
 * `memory.learning.completed`) a legal home. Late results flow through the
 * same observer (`saved` events after the fact) instead of a bespoke
 * channel. */
export type MemoryWebhook = {
  path: string
  verifySignature(input: { rawBody: string; headers: Record<string, string> }): boolean
  handle(input: { rawBody: string }, opts: { signal: AbortSignal }): Promise<IngestOutcome | null>
}
