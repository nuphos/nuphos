import { ObjectId } from 'mongodb'

import { expandSearchQuery } from '../search-text'

import { agentMemories, LIVE_RECORD_FILTER, memoryRecordAccessFilter, teamMemories } from './shared'

import type { AgentMemoryRecord, AgentTeamMemory, PlaybookStatus } from '../types'

// Full-text search across every record the session may read (personal pool +
// this team's team-scope records), ranked by relevance.
// ADR-0008 rung 1: the escape hatch for pools larger than the top-50 index —
// the model queries by keyword, the server searches the FULL readable set.
export async function searchMemoryRecords(
  userId: string,
  teamId: string | null | undefined,
  query: string,
  limit = 8,
  // ADR-0008 rung 2: optional narrowing at recall time. tags = ALL must be
  // present on the record; scope restricts within what access already allows.
  filters?: { tags?: string[]; scope?: 'personal' | 'team' },
): Promise<(AgentMemoryRecord & { score: number })[]> {
  const trimmed = query.trim()

  if (!trimmed) return []

  return agentMemories()
    .find(
      {
        // expandSearchQuery appends dictionary-segmented CJK tokens so a
        // Chinese query can match the textSearch shadow field (track A3).
        $text: { $search: expandSearchQuery(trimmed) },
        ...memoryRecordAccessFilter(userId, teamId),
        ...LIVE_RECORD_FILTER,
        ...(filters?.tags?.length ? { categories: { $all: filters.tags } } : {}),
        ...(filters?.scope ? { scope: filters.scope } : {}),
      },
      { projection: { score: { $meta: 'textScore' } } },
    )
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .toArray() as Promise<(AgentMemoryRecord & { score: number })[]>
}

export type PlaybookSearchHit = {
  memoryId: string
  title: string
  triggerSignals: string[]
  status: PlaybookStatus
  score: number
  /** The other indexed text (case evidence, CJK shadow tokens), for relevance checks. */
  matchText: string
}

// Keyword recall over this team's playbooks (ADR-0008 track A2) — summaries only;
// the model loads full detail with memory_get(memoryId). Mirrors get-by-id
// visibility: active + needs_review, never tombstoned states.
export async function searchTeamPlaybooks(
  teamId: string,
  query: string,
  limit = 5,
): Promise<PlaybookSearchHit[]> {
  const trimmed = query.trim()

  if (!trimmed) return []
  const docs = (await teamMemories()
    .find(
      {
        $text: { $search: expandSearchQuery(trimmed) },
        teamId,
        status: { $in: ['active', 'needs_review'] },
      },
      {
        projection: {
          gene: 1,
          status: 1,
          'capsules.problem': 1,
          'capsules.rootCause': 1,
          searchText: 1,
          score: { $meta: 'textScore' },
        },
      },
    )
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .toArray()) as unknown as (Pick<
    AgentTeamMemory,
    '_id' | 'gene' | 'status' | 'capsules' | 'searchText'
  > & {
    score: number
  })[]

  return docs.map((d) => ({
    memoryId: d._id.toHexString(),
    title: d.gene.title,
    triggerSignals: d.gene.triggerSignals,
    status: d.status,
    score: d.score,
    matchText: [
      ...(d.capsules ?? []).flatMap((c) => [c.problem, c.rootCause ?? '']),
      d.searchText ?? '',
    ].join(' '),
  }))
}

// ── Rung 0.5: relevance clock (ADR-0008) ────────────────────────────────
// Persist that a memory was actually loaded. Deliberately NOT touching
// updatedAt: index ordering and the cached prompt must never churn on reads.
// Callers fire-and-forget — a lost bump is noise, a blocked turn is not.

export async function recordMemoryFetches(memoryIds: ObjectId[]): Promise<void> {
  if (memoryIds.length === 0) return
  const now = new Date()

  await agentMemories().updateMany(
    { _id: { $in: memoryIds } },
    { $inc: { fetchCount: 1 }, $set: { lastFetchedAt: now } },
  )
}

export async function recordPlaybookFetch(teamId: string, memoryId: string): Promise<void> {
  if (!ObjectId.isValid(memoryId)) return
  await teamMemories().updateOne(
    { _id: new ObjectId(memoryId), teamId },
    { $inc: { fetchCount: 1 }, $set: { lastFetchedAt: new Date() } },
  )
}
