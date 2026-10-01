// Runtime ingest dispatcher (Phase 2): the provider-neutral replacement for
// the finalizer's inline distill block in agent.ts (the call-site swap is a
// later PR — this module ships exercised only by its tests until then).
// Fire-and-forget contract: NEVER throws into the caller, budget semantics
// mirror raceRecallBudget, the durable snapshot lands whether or not the SSE
// stream is still open, and the turn row's distill field is derived from the
// provider's diagnostics — the runtime maps, it never branches on vendor
// diagnostics beyond this one sanctioned key.

import { redactSecrets } from '@/lib/journal/redact'
import { logError, logEvent } from '@/lib/observability'

import { recordAttributionSignal, recordTurnDistillOutcome } from './attribution-store'
import { recordIngestEventSnapshot } from './ingest-events'
import { renderMemorySavedFrame } from './save-frame'

import type { TurnDistillOutcome } from './attribution-types'
import type { TurnResolution } from './runtime'
import type { TurnMemoryView } from './turn-accumulator'
import type { IngestOutcome, TurnDigest } from './types'

// Budgets are code constants, not env keys (spec §e) — same stance as the
// recall budget in runtime.ts. sinks.budgetMs is a test hook, clamped.
const INGEST_BUDGET_DEFAULT_MS = 30_000
const INGEST_BUDGET_CEILING_MS = 60_000

/** diagnostics.outcome values the runtime maps onto the turn row. Everything
 * else (vendor-custom strings) is logged-verbatim-in-the-snapshot only —
 * 'skipped_disabled' is deliberately absent: it is capture's default and must
 * keep meaning ONLY "flag off" (a provider cannot claim it). */
const DISTILL_OUTCOMES: ReadonlySet<string> = new Set([
  'saved',
  'deduped',
  'rejected',
  'no_learn',
  'skipped_short',
  'skipped_volatile',
  'skipped_origin',
  'failed',
] satisfies TurnDistillOutcome[])

export type TurnIngestSinks = {
  /** == requestId; keys the distill outcome and the durable snapshot. */
  turnKey: string
  /** Present only while the SSE stream is still open — the learned frame is
   * best-effort, the snapshot is the durable record. */
  emitFrame?: (frame: Record<string, unknown>) => void
  /** Accumulator view; its alreadyRecalled labels plus the titles of memories
   * explicitly saved this turn become the distiller's dedup hint on the
   * digest (a same-turn save must not be auto-relearned). */
  view?: Pick<TurnMemoryView, 'alreadyRecalled' | 'savedTitles'>
  /** Test hook — production callers omit it. */
  budgetMs?: number
}

/** Races provider.ingest.onTurnFinished against the ingest budget. Timeout,
 * throw, and absent slot all resolve null — ingest failure is "nothing
 * learned", NEVER a turn error (a hung provider is abandoned; its late
 * settlement is swallowed). */
async function raceIngestBudget(
  resolution: Extract<TurnResolution, { kind: 'active' }>,
  digest: TurnDigest,
  declaredBudgetMs: number | undefined,
): Promise<IngestOutcome | null> {
  const ingest = resolution.provider.ingest

  if (!ingest) return null
  const budgetMs = Math.min(
    typeof declaredBudgetMs === 'number' &&
      Number.isFinite(declaredBudgetMs) &&
      declaredBudgetMs > 0
      ? declaredBudgetMs
      : INGEST_BUDGET_DEFAULT_MS,
    INGEST_BUDGET_CEILING_MS,
  )
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, budgetMs)

  try {
    const outcome = ingest.onTurnFinished(digest, { signal: controller.signal })
    // Attach the swallow handler NOW: an abandoned ingest rejecting after the
    // deadline must not surface as an unhandled rejection.
    const guarded = outcome.catch((err: unknown) => {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        logError('memory.ingest.failed', err, { provider: resolution.providerId })
      }

      return null
    })
    const deadline = new Promise<null>((resolve) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          logError(
            'memory.ingest.budget_exceeded',
            new Error(`ingest budget ${String(budgetMs)}ms exceeded`),
            { provider: resolution.providerId },
          )
          resolve(null)
        },
        { once: true },
      )
    })

    return await Promise.race([guarded, deadline])
  } catch (err) {
    // Synchronous throw from a misbehaving onTurnFinished().
    logError('memory.ingest.failed', err, { provider: resolution.providerId })

    return null
  } finally {
    clearTimeout(timer)
  }
}

/** A provider that superseded an existing memory reports the id in its
 * diagnostics; recording the negative signal is the RUNTIME's duty, because the
 * turnKey it is keyed by lives in this layer. Same sanctioned-key stance as
 * `outcome`: read the two documented keys, never branch on anything else a
 * vendor puts in diagnostics. Best-effort — a lost signal must not fail ingest,
 * and it must never mask the write that already happened. */
async function recordSupersedeCorrection(
  providerId: string,
  digest: TurnDigest,
  turnKey: string,
  outcome: IngestOutcome,
): Promise<void> {
  const supersededId = outcome.diagnostics?.supersededMemoryId

  if (typeof supersededId !== 'string' || !supersededId) return
  try {
    await recordAttributionSignal({
      provider: providerId,
      teamId: digest.teamId,
      userId: digest.userId,
      conversationId: digest.conversationId,
      turnKey,
      memoryId: supersededId,
      lineage: null,
      scope: outcome.diagnostics?.supersededScope === 'team' ? 'team' : 'personal',
      signal: { signal: 'supersede_correction', at: new Date() },
    })
  } catch (err) {
    logError('memory.ingest.supersede_signal_failed', err, { provider: providerId })
  }
}

export async function dispatchTurnIngest(
  resolution: TurnResolution,
  digest: TurnDigest,
  sinks: TurnIngestSinks,
): Promise<void> {
  try {
    if (resolution.kind !== 'active' || !resolution.provider.ingest) return
    // The distiller's dedup hint: what recall already surfaced this turn,
    // plus what the user explicitly saved during it (recalled labels first;
    // the Set drops a title recall already carried). Always an array — a
    // provider must never see undefined here.
    const recalled = sinks.view?.alreadyRecalled ?? digest.alreadyRecalled ?? []

    digest.alreadyRecalled = [...new Set([...recalled, ...(sinks.view?.savedTitles ?? [])])]
    const outcome = await raceIngestBudget(resolution, digest, sinks.budgetMs)

    // Bare null = "nothing to record" (flag off, disabled path): no snapshot,
    // no distill write — capture's 'skipped_disabled' default stays honest.
    if (!outcome) return

    const distill = outcome.diagnostics?.outcome

    if (typeof distill === 'string' && DISTILL_OUTCOMES.has(distill)) {
      if (distill === 'rejected') {
        // Parity with agent.ts: secret-gate refusals are silent for the user
        // but never for ops. The reason is PROVIDER-controlled and can echo
        // the very content the gate refused — redact before it touches
        // telemetry, and cap it (same stance as the searched-query sink).
        const reason = outcome.diagnostics?.reason

        logEvent('warn', 'agent.memory.auto_ingest_rejected', {
          session_id: digest.conversationId,
          provider: resolution.providerId,
          ...(typeof reason === 'string'
            ? { reason: redactSecrets(reason).redacted.slice(0, 300) }
            : {}),
        })
      }
      await recordTurnDistillOutcome(
        digest.conversationId,
        sinks.turnKey,
        distill as TurnDistillOutcome,
      )
    }

    await recordSupersedeCorrection(resolution.providerId, digest, sinks.turnKey, outcome)

    // Durable snapshot FIRST-CLASS, frame best-effort: the stream is usually
    // closed by the time ingest resolves; GET /memories/ingest reads this.
    await recordIngestEventSnapshot({
      provider: resolution.providerId,
      teamId: digest.teamId,
      userId: digest.userId,
      conversationId: digest.conversationId,
      turnKey: sinks.turnKey,
      outcome,
    })

    if (sinks.emitFrame) {
      for (const event of outcome.saved) {
        // Only live creations render the learned chip: 'updated'/'superseded'
        // are the lifecycle-fact channel (types.ts IngestOutcome note),
        // 'deleted' is vendor-autonomous removal, 'drafted' is pending-review
        // (its card is a later-phase UX). Same rule as the accumulator sink.
        if (event.action !== 'created') continue
        sinks.emitFrame(
          renderMemorySavedFrame({
            eventId: `${digest.conversationId}:auto-ingest:${event.id}`,
            sessionId: digest.conversationId,
            event,
          }),
        )
      }
    }
  } catch (err) {
    // Belt over the per-step braces: nothing here may reject into the turn.
    logError('memory.ingest.dispatch_failed', err, {
      provider:
        resolution.kind === 'active' ? resolution.providerId : (resolution.providerId ?? 'none'),
    })
  }
}
