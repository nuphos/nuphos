import { ObjectId } from 'mongodb'

import { config } from '@/config'

import { rankByDecay } from '../decay'

import {
  agentMemories,
  INDEX_LIMIT,
  LIVE_RECORD_FILTER,
  memoryRecordAccessFilter,
  teamMemories,
} from './shared'

import type { AgentMemoryRecord, AgentTeamMemory } from '../types'

export type TeamIndexEntry = { memoryId: string; title: string; triggerSignals: string[] }

export async function listActivePlaybooks(
  teamId: string,
  limit = INDEX_LIMIT,
): Promise<{ entries: TeamIndexEntry[]; total: number }> {
  const query = { teamId, status: 'active' as const }

  type PlaybookIndexDoc = {
    _id: ObjectId
    gene: { title: string; triggerSignals: string[] }
    updatedAt: Date
    lastFetchedAt?: Date
    lastVerifiedAt?: Date
    fetchCount?: number
  }
  const projection = {
    'gene.title': 1,
    'gene.triggerSignals': 1,
    updatedAt: 1,
    lastFetchedAt: 1,
    lastVerifiedAt: 1,
    fetchCount: 1,
  }
  // Rung 3 ranking half (flagged): score the WHOLE pool by access decay in
  // the app (pools are ≤ a few hundred docs), else let Mongo sort by recency.
  const decay = config.agent.memoryIndexRanking === 'decay'
  const [docs, total] = await Promise.all([
    decay
      ? teamMemories()
          .find(query)
          .project<PlaybookIndexDoc>(projection)
          .toArray()
          .then((all) => rankByDecay(new Date(), all).slice(0, limit))
      : teamMemories()
          .find(query)
          .sort({ updatedAt: -1 })
          .limit(limit)
          .project<PlaybookIndexDoc>(projection)
          .toArray(),
    teamMemories().countDocuments(query),
  ])

  return {
    entries: docs.map((d) => ({
      memoryId: d._id.toHexString(),
      title: d.gene.title,
      triggerSignals: d.gene.triggerSignals,
    })),
    total,
  }
}

export async function getTeamMemory(
  teamId: string,
  memoryId: string,
): Promise<AgentTeamMemory | null> {
  if (!ObjectId.isValid(memoryId)) return null

  // Same visibility rule as the index and searchTeamPlaybooks: a rejected or
  // superseded playbook must not be retrievable by remembered id (review).
  // Removed-items listing/restore in records-api use their own queries.
  return teamMemories().findOne({
    _id: new ObjectId(memoryId),
    teamId,
    status: { $in: ['active', 'needs_review'] },
  })
}

export async function getMemoryRecord(
  memoryId: string,
  userId: string,
  teamId: string | null | undefined,
): Promise<AgentMemoryRecord | null> {
  if (!ObjectId.isValid(memoryId)) return null

  return agentMemories().findOne({
    _id: new ObjectId(memoryId),
    ...memoryRecordAccessFilter(userId, teamId),
    ...LIVE_RECORD_FILTER,
  })
}

export type MemoryRecordIndexEntry = {
  memoryId: string
  // Authored title when the record has one (ADR-0008 track B), else the
  // first line of the text — 72% of imported records cut mid-sentence at
  // 100 chars, which is exactly why authored titles exist.
  label: string
}

// Size of the team-scope flat pool (team saves). These
// records are search-only — never rendered per-entry into context — but the
// index must still advertise that they exist, or the model has no reason to
// ever call memory_get over them (observed: it re-investigates from scratch).
// Pool-size denominators for delivery-mode telemetry (ADR-0003 A/B/C):
// automatic mode renders no index, but its memory.retrieved events must
// carry pool totals like the other arms. The playbook denominator mirrors
// searchTeamPlaybooks' status set (active + needs_review) — the pool automatic
// recall actually draws from — so candidates and totals stay consistent.
export async function countSearchablePlaybooks(teamId: string): Promise<number> {
  return teamMemories().countDocuments({ teamId, status: { $in: ['active', 'needs_review'] } })
}

export async function countPersonalMemoryRecords(
  userId: string,
  teamId: string | null,
): Promise<number> {
  return agentMemories().countDocuments({
    scope: 'personal',
    ownerUserId: userId,
    teamId,
    ...LIVE_RECORD_FILTER,
  })
}

export async function countTeamMemoryRecords(teamId: string): Promise<number> {
  return agentMemories().countDocuments({ scope: 'team', teamId, ...LIVE_RECORD_FILTER })
}

export async function listPersonalMemoryIndex(
  userId: string,
  teamId: string | null,
  limit = INDEX_LIMIT,
): Promise<{ entries: MemoryRecordIndexEntry[]; total: number }> {
  // Pool semantics mirror xtrace: personal memory is scoped to (user, team);
  // team-context personal and solo are distinct pools.
  const query = { scope: 'personal' as const, ownerUserId: userId, teamId, ...LIVE_RECORD_FILTER }

  type RecordIndexDoc = {
    _id: ObjectId
    text: string
    title?: string
    source: string
    updatedAt: Date
    lastFetchedAt?: Date
    fetchCount?: number
  }
  const projection = { text: 1, title: 1, source: 1, updatedAt: 1, lastFetchedAt: 1, fetchCount: 1 }
  const decay = config.agent.memoryIndexRanking === 'decay'
  const [docs, total] = await Promise.all([
    decay
      ? agentMemories()
          .find(query)
          .project<RecordIndexDoc>(projection)
          .toArray()
          .then((all) => rankByDecay(new Date(), all).slice(0, limit))
      : agentMemories()
          .find(query)
          .sort({ updatedAt: -1 })
          .limit(limit)
          .project<RecordIndexDoc>(projection)
          .toArray(),
    agentMemories().countDocuments(query),
  ])

  return {
    entries: docs.map((d) => ({
      memoryId: d._id.toHexString(),
      label: d.title || (d.text.split('\n', 1)[0] ?? '').slice(0, 100),
    })),
    total,
  }
}

/** Titles auto-ingest already saved in THIS conversation, newest first.
 *
 * The distiller's only redundancy signal, `alreadyKnown`, was turn-scoped:
 * memories recalled this turn plus ones `save_memory` wrote this turn. Nothing
 * carried what EARLIER turns of the same conversation had already learned.
 * Recall could surface them, but it is lexical and capped, so across a long
 * investigation it usually does not — and each turn then distilled as if the
 * conversation had just begun. Measured on prod: 11 conversations produced 3+
 * memories each and held 65% of the live pool, one of them 18 records covering
 * the same migration a plan number apart.
 *
 * Exact-hash dedup cannot catch these: every turn words it differently.
 */
export async function listConversationMemoryTitles(
  conversationId: string,
  limit = 12,
): Promise<string[]> {
  const docs = await agentMemories()
    .find({ conversationId, ...LIVE_RECORD_FILTER })
    .sort({ createdAt: -1 })
    .limit(limit)
    .project<{ title?: string; text: string }>({ title: 1, text: 1 })
    .toArray()

  // Title is what the index shows and what the prompt compares against; fall
  // back to the opening line so a record written before titles existed still
  // participates in dedup rather than silently licensing a repeat.
  return docs.map((d) => {
    // An empty title is present-but-useless, so it falls through to the body
    // rather than contributing a blank label — which `??` would not do.
    const title = d.title?.trim() ?? ''

    if (title) return title

    return (d.text.split('\n')[0] ?? '').slice(0, 120)
  })
}
