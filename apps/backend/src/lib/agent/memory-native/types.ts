// Native team memory (Case/Playbook) — PoC types per docs/memory-poc-analysis.md §4.3–4.4, §17.3.
// PR 1 scope: types + replay fixtures only. No production behavior change.

import type { ObjectId } from 'mongodb'

export type PlaybookStatus = 'active' | 'needs_review' | 'superseded' | 'rejected'
export type CaseOutcome = 'confirmed' | 'partial' | 'failed'

export type PlaybookStep = {
  action: string
  check: string
  nextWhen?: string
}

// Reusable investigation strategy distilled from one or more Cases.
export type Playbook = {
  title: string
  triggerSignals: string[]
  investigationPath: PlaybookStep[]
  traps: string[]
  doNotUseWhen: string[]
}

// One concrete handling record: sanitized assertions + evidence pointers.
// Never raw tool output, credentials, or unverified assistant guesses.
export type EmbeddedCase = {
  outcome: CaseOutcome
  problem: string
  rootCause?: string
  actions: string[]
  verification: string[]
  conversationId: string
  planId?: string
  toolCallIds: string[]
  authorUserId: string
  observedAt: Date
  // Offline legacy distillation provenance (docs/memory-legacy-distillation-spec.md):
  // hex ids of the agent_memories records this case was distilled from.
  // Absent on cases born from live conversations.
  sourceMemoryIds?: string[]
}

// `agent_team_memories` — one document per active Playbook revision, cases embedded
// so publish / confirmed-reuse / revision are single-document atomic updates (§17.3).
// NOTE: the persisted document fields `gene` and `capsules` (and the proposal
// fields `draftGene` / `draftCapsule`) keep their legacy names until the data
// migration PR — only the TypeScript vocabulary is Playbook/Case.
export type AgentTeamMemory = {
  _id: ObjectId
  teamId: string
  // Stable identity across revisions (review finding: lineage identity).
  // First revision: its own _id hex; later revisions copy it.
  lineageId: string
  status: PlaybookStatus
  revision: number
  gene: Playbook
  capsules: EmbeddedCase[]
  createdBy: string
  createdAt: Date
  updatedBy: string
  updatedAt: Date
  lastVerifiedAt?: Date
  // Status the playbook held when it was soft-deleted to 'rejected', so restore
  // puts it back there instead of promoting a needs_review playbook to active.
  // Absent on legacy tombstones — those restore to 'active'.
  rejectedFromStatus?: 'active' | 'needs_review'
  // Optional human-stated reason at removal time (redacted, ≤300 chars).
  rejectedReason?: string
  supersedesId?: ObjectId
  // CJK shadow tokens for the collection text index (ADR-0008 track A3);
  // absent when title/signals/cases contain no CJK.
  searchText?: string
  // Rung 0.5 relevance clock (ADR-0008): bumped on every successful
  // memory_get load, NEVER touching updatedAt (index order and prompt cache
  // must not churn on reads). Distinct from lastVerifiedAt (trust clock).
  fetchCount?: number
  lastFetchedAt?: Date
}

// `agent_team_memory_proposals` — proposal-gated publish; nothing enters the
// team store without an explicit user decision.
export type AgentTeamMemoryProposal = {
  _id: ObjectId
  teamId: string
  userId: string
  conversationId: string
  status: 'proposed' | 'published' | 'discarded'
  draftGene: Playbook
  draftCapsule: EmbeddedCase
  idempotencyKey: string
  createdAt: Date
  expiresAt: Date
  publishedMemoryId?: ObjectId
  // save_memory team supersede: the live playbook this proposal corrects. When
  // set, publishProposal revises that playbook's lineage (bump revision, retire
  // the prior) instead of minting a fresh one.
  supersedesMemoryId?: ObjectId
}

// `agent_memories` — flat memory records (personal layer
// legacy), per docs/memory-poc-personal-layer-spec.md. NOT Playbook/Case;
// served through /memories* routes as AgentMemoryItem.
export type AgentMemoryRecordType = 'fact' | 'artifact' | 'episode'

export type AgentMemoryRecord = {
  _id: ObjectId
  scope: 'personal' | 'team'
  ownerUserId: string | null // set for personal; null for team-scope legacy
  teamId: string | null // set for team-scope legacy and team-context personal
  type: AgentMemoryRecordType
  text: string
  categories: string[]
  source: 'save_memory' | 'auto_ingest'
  conversationId: string | null
  // ADR-0008 track B: authored one-line hook for the index (falls back to a
  // text prefix when absent) + retrieval keywords joined into the text index
  // (dual-language keys are the cheap cross-lingual bridge). Backfilled for
  // imported records by backfill-memory-titles.ts (ops tooling branch).
  title?: string
  keywords?: string[]
  // Normalized-content hash (write-time dedupe + tombstone matching,
  // ADR-0006). Absent on records written before 2026-07-15.
  textHash?: string
  // Tombstone (ADR-0005/0006): a removed record is disabled, never deleted —
  // audit survives, restore stays possible, and an identical later save
  // cannot silently resurrect it.
  disabledAt?: Date
  disabledBy?: string
  // Optional human-stated reason at removal time (redacted, ≤300 chars).
  disabledReason?: string
  supersededBy?: ObjectId // set when a newer save explicitly replaced this one
  // CJK shadow tokens for the text index (ADR-0008 track A3); absent when
  // the text contains no CJK. Backfilled once by
  // backfill-memory-search-text.ts (ops tooling branch).
  textSearch?: string
  // Rung 0.5 relevance clock (ADR-0008): bumped on every successful
  // memory_get load or search hit, NEVER touching updatedAt.
  fetchCount?: number
  lastFetchedAt?: Date
  createdAt: Date
  updatedAt: Date
}

// Verdict vocabulary shared with the runtime attribution store (Track A):
// the judge's applied/considered/not_applicable tiers reuse this union. The
// old `agent_team_memory_applications` journal that carried it is deleted —
// superseded by the runtime-owned memory_runtime_* collections.
export type TeamMemoryApplicationAction = 'considered' | 'applied' | 'not_applicable'

// ---------------------------------------------------------------------------
// Stage 0 replay fixtures (§16.4 Stage 0, §9 Phase 0) — offline only.
// NOTE: the fixture-file JSON keys (`genes`, `gene`, `expectedGeneId`,
// `selectedGeneId`) keep their legacy names — existing fixture files on disk
// (e.g. scripts/output/gene-eval-fixtures.json) still use them.

// A historical turn replayed against a candidate Playbook corpus. Positive cases
// expect a specific Playbook at rank 1; negative controls share symptoms with some
// Playbook but have a different root cause and expect silence.
export type ReplayCase = {
  id: string
  kind: 'positive' | 'negative_control'
  conversationId: string
  userText: string
  assistantText?: string
  // Playbook id (fixture-local) expected at rank 1; undefined for negative controls.
  expectedGeneId?: string
  notes?: string
}

export type ReplayPlaybookFixture = {
  id: string
  gene: Playbook
}

export type ReplayFixtureFile = {
  version: 1
  genes: ReplayPlaybookFixture[]
  cases: ReplayCase[]
}

export type ReplayCaseResult = {
  caseId: string
  kind: ReplayCase['kind']
  expectedGeneId?: string
  selectedGeneId?: string
  score: number
  correct: boolean
}

export type ReplayReport = {
  totalCases: number
  positives: number
  negativeControls: number
  recallAt1: number
  falseRecallRate: number
  results: ReplayCaseResult[]
}
