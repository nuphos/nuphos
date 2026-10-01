// Per-turn memory accumulator (Phase 2 runtime machinery): one object owns
// what agent.ts today spreads across three ad-hoc Maps (fetchedMemoryIds,
// fetchedMemoryLabels, supersededMemoryIds), the inline memory.searched sink,
// and the lastMemoryRollup provenance fields. The observer half feeds the
// provider's tool activity in; noteRecall feeds the recall result in; view()
// hands the four onFinish consumers (provenance frame, memory.turn event,
// attribution capture, attribution judge) plus the ingest dispatcher ONE
// consistent snapshot. Runtime-OWNED — providers only ever see the observer.

import { redactSecrets } from '@/lib/journal/redact'

import { createMemoryObserver } from './runtime'
import { renderMemorySavedFrame } from './save-frame'

import type { TurnRecallOutcome } from './attribution-types'
import type {
  MemoryObserver,
  MemorySavedEvent,
  MemoryScope,
  RecalledEntry,
  RenderedMemoryContext,
} from './types'

// Exact port of agent.ts's zh-share indicator regex (ADR-0008 GAP 3): a CJK
// query that matches nothing is silence, never a fetch-then-reject — this
// flag is the only signal that can see it.
const CJK_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\uFAFF]/

export type TurnMemoryView = {
  providerId: string
  requestId: string
  /** Why recall produced what it produced; undefined when noteRecall never
   * ran (resume-skipped turns — the finish path records 'not_planned'). */
  recallOutcome?: TurnRecallOutcome
  /** Null when recall never ran or failed this turn — mirrors agent.ts's
   * lastMemoryRollup null (approval resumes, index errors). memory_get can
   * still have fired, so the fetched fields below stay independent. */
  recall: {
    /** block !== null — "was context actually injected". */
    used: boolean
    count: number
    durationMs: number
    entries: RecalledEntry[]
    diagnostics: Record<string, number | string | boolean> | null
    teamIds: string[]
    personalIds: string[]
  } | null
  fetchedIds: string[]
  fetchedTeamIds: string[]
  fetchedPersonalIds: string[]
  /** Fetch-time content snapshots — the judge's candidates (A4①). */
  fetchedLabels: Map<string, string>
  supersededTeamIds: string[]
  supersededPersonalIds: string[]
  /** Recalled labels — the distiller's alreadyKnown dedup hint. */
  alreadyRecalled: string[]
  /** One-line titles of memories explicitly created this turn (save_memory) —
   * folded into the same alreadyKnown hint so auto-ingest cannot re-learn a
   * fact the user just saved. Insertion order, exact dups once. */
  savedTitles: string[]
}

export type TurnMemoryAccumulator = {
  /** Pre-wrapped fail-open (createMemoryObserver) — hand it to the provider. */
  observer: MemoryObserver
  /** Called once after the recall race settles; null = recall failed/skipped. */
  noteRecall(
    rendered: RenderedMemoryContext | null,
    durationMs: number,
    outcome?: TurnRecallOutcome,
  ): void
  /** Merge a save observed on another replica without re-emitting its UI
   * frame (the MCP replica already published that frame). */
  noteSaved(event: MemorySavedEvent): void
  view(): TurnMemoryView
}

export function createTurnMemoryAccumulator(input: {
  providerId: string
  sessionId: string
  userId: string
  teamId: string | null
  requestId: string
  /** SSE frame sink (appendAgentRunFrame in production). */
  emitFrame: (frame: Record<string, unknown>) => void
  /** Telemetry sink (recordAgentEvent in production; injectable for tests). */
  recordEvent: (fields: {
    conversationId: string
    event: string
    userId?: string
    data?: Record<string, unknown>
  }) => void
}): TurnMemoryAccumulator {
  const { providerId, sessionId, userId, requestId } = input

  // id → scope, so provenance can tell the desktop where each item lives
  // (inspect/remove need the right pool; playbooks are team).
  const fetchedIds = new Map<string, MemoryScope>()
  const fetchedLabels = new Map<string, string>()
  // Old memory ids whose supersede landed this turn — the negative
  // supersede_correction signal, keyed by supersededId (never event.id).
  const supersededIds = new Map<string, MemoryScope>()
  // Titles of live creations, in arrival order — a Set collapses the exact-dup
  // case (same fact saved into both pools) while keeping insertion order.
  const savedTitles = new Set<string>()
  let recall: TurnMemoryView['recall'] = null
  let recallOutcome: TurnRecallOutcome | undefined

  const noteSaved = (event: MemorySavedEvent, emitFrame: boolean) => {
    if (event.action === 'superseded' || event.action === 'updated') {
      if (event.supersededId) supersededIds.set(event.supersededId, event.scope ?? 'personal')

      return
    }
    if (event.action !== 'created') return
    if (event.title) savedTitles.add(event.title)
    if (!emitFrame) return
    input.emitFrame(
      renderMemorySavedFrame({
        eventId: `${sessionId}:memory-saved:${event.id}`,
        sessionId,
        event,
      }),
    )
  }

  const observer = createMemoryObserver({
    providerId,
    sinks: {
      saved: (event) => {
        noteSaved(event, true)
      },
      fetched: (event) => {
        fetchedIds.set(event.id, event.scope)
        if (event.label !== undefined) fetchedLabels.set(event.id, event.label)
      },
      searched: (event) => {
        input.recordEvent({
          conversationId: sessionId,
          event: 'memory.searched',
          userId,
          data: {
            // Redact BEFORE truncating: slicing first can cut a secret in
            // half, leaving a fragment the redactor no longer matches.
            query: redactSecrets(event.query).redacted.slice(0, 200),
            queryHasCjk: CJK_RE.test(event.query),
            // Persisted analytics keys keep their legacy shapes: hitCount is
            // the flat-record count (hitsByKind.record; a vendor without the
            // breakdown falls back to its total), geneHitCount the playbook
            // count until the data migration renames it.
            hitCount: event.hitsByKind?.record ?? event.hitCount,
            geneHitCount: event.hitsByKind?.playbook ?? 0,
          },
        })
      },
    },
  })

  const idsByScope = (entries: { id: string; scope: MemoryScope }[], scope: MemoryScope) =>
    entries.filter((e) => e.scope === scope).map((e) => e.id)

  return {
    observer,
    noteRecall: (rendered, durationMs, outcome) => {
      if (outcome) recallOutcome = outcome
      else if (!rendered) recallOutcome = 'failed'
      else recallOutcome = rendered.recalled.length ? 'matched' : 'no_match'
      if (!rendered) return // failed/aborted recall stays honest: no rollup
      recall = {
        used: rendered.block !== null,
        count: rendered.recalled.length,
        durationMs,
        entries: rendered.recalled,
        diagnostics: rendered.diagnostics ?? null,
        teamIds: idsByScope(rendered.recalled, 'team'),
        personalIds: idsByScope(rendered.recalled, 'personal'),
      }
    },
    noteSaved: (event) => {
      noteSaved(event, false)
    },
    view: () => {
      const fetched = [...fetchedIds.entries()].map(([id, scope]) => ({ id, scope }))
      const superseded = [...supersededIds.entries()].map(([id, scope]) => ({ id, scope }))

      return {
        providerId,
        requestId,
        recall,
        recallOutcome,
        fetchedIds: fetched.map((e) => e.id),
        fetchedTeamIds: idsByScope(fetched, 'team'),
        fetchedPersonalIds: idsByScope(fetched, 'personal'),
        fetchedLabels: new Map(fetchedLabels),
        supersededTeamIds: idsByScope(superseded, 'team'),
        supersededPersonalIds: idsByScope(superseded, 'personal'),
        alreadyRecalled: recall?.entries.map((e) => e.label) ?? [],
        savedTitles: [...savedTitles],
      }
    },
  }
}
