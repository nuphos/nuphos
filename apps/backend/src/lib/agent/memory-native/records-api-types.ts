// Wire DTOs — field-for-field what the desktop expects
// (apps/desktop/src/api.ts:1992-2037). Formerly defined in the xtrace-backed
// lib/agent/memory.ts; compatibility is maintained additively in this file.

export type MemoryScope = 'personal' | 'team'

export type MemoryListItem = {
  id: string
  type: 'fact' | 'artifact' | 'episode'
  /** One-line retrieval label for flat records. Older/imported records may
   * not have one; Playbooks continue to expose their title through `gene`. */
  title?: string
  text: string
  categories: string[]
  createdAt: string
  updatedAt: string
  convId: string | null
  userId: string | null
  appId: string | null
  groupIds: string[]
  // Present only on state=removed listings (ADR-0005: the tombstone shows
  // who removed it and when, and can be reverted). Additive — the frozen
  // xtrace-parity fields above are untouched and live listings omit these.
  disabledAt?: string
  disabledBy?: string
  disabledReason?: string
  // Present only on team Playbooks (ADR-0007 #4, wire field `gene` keeps its
  // legacy name): the structured strategy so the
  // UI can render Signals / Investigation path / Traps as sections instead of
  // re-parsing the flattened `text` blob above. Additive — flat records omit it.
  gene?: {
    title: string
    triggerSignals: string[]
    investigationPath: { action: string; check: string; nextWhen?: string }[]
    traps: string[]
    doNotUseWhen: string[]
    status: string
    revision?: number
    // Detail (get-by-id) responses only — list payloads stay light. The
    // evidence behind the strategy (ADR-0007 item 6): humans deciding
    // keep/remove must see what the model already sees via memory_get.
    // Read-only by design: cases are append-only evidence with no
    // per-case mutation surface (wire field `capsules` keeps its legacy name).
    capsules?: {
      outcome: string
      problem: string
      rootCause?: string
      actions: string[]
      verification: string[]
      conversationId: string
      planId?: string
      observedAt: string
    }[]
  }
}

export type MemoryListPage = {
  enabled: boolean
  memories: MemoryListItem[]
  nextCursor: string | null
  hasMore: boolean
}

export type MemoryIngestEventItem = {
  id: string
  type: 'fact' | 'artifact' | 'episode'
  title?: string
  text: string
  categories: string[]
  scopes: MemoryScope[]
  createdAt: string
  updatedAt: string
}

export type MemoryIngestEventPage = {
  enabled: boolean
  status?: 'pending' | 'ok'
  memories: MemoryIngestEventItem[]
}
