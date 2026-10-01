import { createHash } from 'node:crypto'

import { db } from '@/lib/db'
import { redactSecrets } from '@/lib/journal/redact'

import type {
  AgentMemoryRecord,
  AgentTeamMemory,
  AgentTeamMemoryProposal,
  Playbook,
} from '../types'
import type { Collection } from 'mongodb'

const MEMORIES = 'agent_team_memories'
const PROPOSALS = 'agent_team_memory_proposals'

// Exported for conformance-harness ground truth (existsInRealStore must
// bypass RecordsSurface against the real collection, not a copied literal).
export const MEMORY_RECORDS_COLLECTION = 'agent_memories'
const RECORDS = MEMORY_RECORDS_COLLECTION

export const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const INDEX_LIMIT = 50

export const teamMemories = (): Collection<AgentTeamMemory> => db().collection(MEMORIES)
export const teamMemoryProposals = (): Collection<AgentTeamMemoryProposal> =>
  db().collection(PROPOSALS)
export const agentMemories = (): Collection<AgentMemoryRecord> => db().collection(RECORDS)

// ── Pure helpers (unit-tested) ──────────────────────────────────────────

export function proposalIdempotencyKey(conversationId: string, title: string): string {
  return createHash('sha256')
    .update(`${conversationId}\n${title.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)
}

// Content identity for flat records (ADR-0006 write gate): whitespace and
// case are presentation, not meaning.
export function memoryTextHash(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase()

  return createHash('sha256').update(normalized).digest('hex').slice(0, 32)
}

// Content identity for playbooks (same rationale, same hash): a canonical JSON
// serialization of the semantic fields — fixed field order by construction,
// array order kept (it is part of the meaning for investigationPath, and
// keeping it everywhere makes the tombstone gate byte-identical-only).
export function playbookContentHash(playbook: Playbook): string {
  return memoryTextHash(
    JSON.stringify([
      playbook.title,
      playbook.triggerSignals,
      playbook.investigationPath.map((s) => [s.action, s.check, s.nextWhen ?? null]),
      playbook.traps,
      playbook.doNotUseWhen,
    ]),
  )
}

// Every read path filters tombstones; deleteMemoryItem sets them.
export const LIVE_RECORD_FILTER = { disabledAt: { $exists: false } } as const

// One walk serves two callers: the fail-closed write gate (kinds only) and
// auto-ingest's redact-and-save fallback (which needs the masked copy too).
// Redact each RAW string, never a JSON encoding: stringify escapes quotes and
// newlines, which breaks the quoted-value alternatives of the secret patterns
// (e.g. password: "hunter2-s3cret" sails through the escaped form untouched).
export function redactSecretBearingContent<T>(value: T): { redacted: T; kinds: string[] } {
  const kinds = new Set<string>()
  const visit = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const result = redactSecrets(v)

      for (const m of result.matches) kinds.add(m.kind)

      return result.redacted
    }
    if (Array.isArray(v)) return v.map(visit)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, visit(item)]))
    }

    return v
  }

  return { redacted: visit(value) as T, kinds: [...kinds] }
}

// Fail closed: any redaction hit anywhere in the draft rejects the proposal.
export function findSecretBearingContent(value: unknown): string | null {
  const { kinds } = redactSecretBearingContent(value)

  return kinds.length ? kinds.join(', ') : null
}

// Hard access filter for flat memory records: personal records are readable
// only by their owner AND only within the current pool — personal pools are
// (user, team), so a team-context turn must not surface the owner's other
// team pools or solo pool (review F1: cross-team context leak). Team-scope
// records only with the caller's VERIFIED teamId (resolveVerifiedTeamId
// upstream — never model-supplied).
export function memoryRecordAccessFilter(
  userId: string,
  teamId: string | null | undefined,
): Record<string, unknown> {
  return {
    $or: [
      { scope: 'personal', ownerUserId: userId, teamId: teamId ?? null },
      ...(teamId ? [{ scope: 'team', teamId }] : []),
    ],
  }
}
