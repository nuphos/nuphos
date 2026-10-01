// Bounded, deterministic memory indexes (§4.2, §17.9): one-line entries only —
// the agent loads full detail on demand via memory_get. Injected AFTER the
// second cachePoint so index churn never invalidates the cached prompt prefix.

import { config } from '@/config'

import { fetchRetentionOrderScores } from '../memory-slots/attribution-store'

import {
  dedupeTrustWording,
  formatAutomaticRecall,
  formatMemorySummary,
  formatPersonalIndex,
  formatTeamIndex,
  formatTeamRecordsNotice,
} from './context-format'
import { sharesEnoughQueryTerms } from './recall-relevance'
import { orderByRetention, rerankCandidates } from './rerank'
import {
  countPersonalMemoryRecords,
  countSearchablePlaybooks,
  countTeamMemoryRecords,
  listActivePlaybooks,
  listPersonalMemoryIndex,
  searchMemoryRecords,
  searchTeamPlaybooks,
} from './store'

import type { AutomaticRecallEntry, RenderedMemoryContext } from './context-format'

export {
  formatAutomaticRecall,
  formatMemorySummary,
  formatPersonalIndex,
  formatTeamIndex,
  formatTeamRecordsNotice,
} from './context-format'
export type { AutomaticRecallEntry, RenderedMemoryContext } from './context-format'

const AUTOMATIC_RECALL_LIMIT = 5
const AUTOMATIC_CANDIDATES_PER_SOURCE = 10
// $text score floors before a candidate may be ATTACHED (memory_get search
// results are never floored — there the model asked and judges for itself).
// Without a floor the five-pointer budget always fills: generic CJK tokens
// (機器/刪除/…) give every realistic zh query a full page of 2–5-point noise.
// Empirical split on the dev corpus (33 playbooks / 533 records): garbage
// queries top out at 5.63 (records) / 6.15 (playbooks); real hits start at 6.4
// / 13. Scores scale with query length, so terse queries may fall below the
// floor and attach nothing — acceptable: the model then searches on its own
// (proven behavior), and memory.turn's pointer-precision data decides any
// retune.
const AUTOMATIC_RECORD_SCORE_FLOOR = 6
const AUTOMATIC_PLAYBOOK_SCORE_FLOOR = 7

// Mongo text scores are collection-local, so comparing a record score with a
// playbook score directly would manufacture precision. Without the optional LLM
// reranker, preserve each source's lexical order and alternate them so neither
// collection can starve the other from the five-pointer budget.
export function interleaveAutomaticRecall(
  records: AutomaticRecallEntry[],
  playbooks: AutomaticRecallEntry[],
  limit = AUTOMATIC_RECALL_LIMIT,
): AutomaticRecallEntry[] {
  const selected: AutomaticRecallEntry[] = []

  for (let i = 0; selected.length < limit && (i < records.length || i < playbooks.length); i++) {
    const record = records[i]

    if (record) selected.push(record)
    if (selected.length >= limit) break
    const playbook = playbooks[i]

    if (playbook) selected.push(playbook)
  }

  return selected
}

export async function renderAutomaticMemoryRecall(
  userId: string,
  teamId: string | null | undefined,
  query: string,
  /** Conversation the recall is for. Only used to attribute the optional
   *  rerank model call's token usage to the real session. */
  conversationId?: string,
  /** Pointers already attached earlier in this conversation. */
  excludeIds: readonly string[] = [],
): Promise<RenderedMemoryContext> {
  const trimmed = query.trim()

  if (!trimmed) {
    return {
      block: null,
      teamCount: 0,
      personalCount: 0,
      teamIds: [],
      personalIds: [],
      entries: [],
    }
  }

  // Pool totals ride along even though no index is rendered, so this arm's
  // memory.retrieved events carry denominators like the others (ADR-0003).
  // The playbook total counts active + needs_review — the statuses search
  // actually recalls from — so it can sit slightly above injection's
  // active-only index total; that skew is the modes' real pool difference,
  // not a telemetry bug.
  const [recordHits, playbookHits, teamTotal, personalTotal, teamRecordTotal] = await Promise.all([
    searchMemoryRecords(userId, teamId, trimmed, AUTOMATIC_CANDIDATES_PER_SOURCE),
    teamId
      ? searchTeamPlaybooks(teamId, trimmed, AUTOMATIC_CANDIDATES_PER_SOURCE)
      : Promise.resolve([]),
    teamId ? countSearchablePlaybooks(teamId) : Promise.resolve(0),
    countPersonalMemoryRecords(userId, teamId ?? null),
    teamId ? countTeamMemoryRecords(teamId) : Promise.resolve(0),
  ])
  const excluded = new Set(excludeIds)
  const records: AutomaticRecallEntry[] = recordHits
    .filter(
      (record) =>
        record.score >= AUTOMATIC_RECORD_SCORE_FLOOR &&
        !excluded.has(record._id.toHexString()) &&
        sharesEnoughQueryTerms(trimmed, [
          record.title,
          record.keywords?.join(' '),
          record.text,
          record.textSearch,
        ]),
    )
    .map((record) => ({
      memoryId: record._id.toHexString(),
      scope: record.scope,
      kind: 'record',
      label: record.title || record.text.split('\n', 1)[0] || record.text,
    }))
  const playbooks: AutomaticRecallEntry[] = playbookHits
    .filter(
      (playbook) =>
        playbook.score >= AUTOMATIC_PLAYBOOK_SCORE_FLOOR &&
        !excluded.has(playbook.memoryId) &&
        sharesEnoughQueryTerms(trimmed, [
          playbook.title,
          playbook.triggerSignals.join(' '),
          playbook.matchText,
        ]),
    )
    .map((playbook) => ({
      memoryId: playbook.memoryId,
      scope: 'team',
      kind: 'gene',
      label: playbook.title,
      triggerSignals: playbook.triggerSignals,
    }))
  // Interleave BEFORE the optional rerank: rerankCandidates returns its
  // input order on failure, so the fallback must already be the fused list —
  // records-then-playbooks concat would starve playbooks out of the five-slot budget
  // whenever the reranker errors.
  const candidates = interleaveAutomaticRecall(
    records,
    playbooks,
    records.length + playbooks.length,
  )
  // Track A 2.4 (same flag, no new env key): proven retention reorders the
  // candidates before the LLM rerank — and thereby also becomes the fail-open
  // order. Unproven memories stay put; only measured applyRate moves anything.
  const ordered =
    config.agent.memoryRerankEnabled && candidates.length > 1
      ? orderByRetention(candidates, await fetchRetentionOrderScores(teamId ?? null, candidates))
      : candidates
  const entries = (
    config.agent.memoryRerankEnabled
      ? await rerankCandidates(trimmed, ordered, {
          userId,
          teamId: teamId ?? null,
          sessionId: conversationId,
        })
      : ordered
  ).slice(0, AUTOMATIC_RECALL_LIMIT)
  const teamIds = entries.filter((entry) => entry.scope === 'team').map((entry) => entry.memoryId)
  const personalIds = entries
    .filter((entry) => entry.scope === 'personal')
    .map((entry) => entry.memoryId)

  return {
    block: formatAutomaticRecall(entries),
    teamCount: teamIds.length,
    personalCount: personalIds.length,
    teamTotal,
    personalTotal,
    teamRecordTotal,
    teamIds,
    personalIds,
    entries,
  }
}

export async function renderTeamIndexBlock(teamId: string): Promise<string | null> {
  const { entries, total } = await listActivePlaybooks(teamId)

  return formatTeamIndex(entries, total)
}

export async function renderPersonalIndexBlock(
  userId: string,
  teamId: string | null,
): Promise<string | null> {
  const { entries, total } = await listPersonalMemoryIndex(userId, teamId)

  return formatPersonalIndex(entries, total)
}

// Both indexes for one turn, rendered concurrently.
export async function renderMemoryIndexes(
  userId: string,
  teamId: string | null | undefined,
): Promise<RenderedMemoryContext> {
  const [team, personal, teamRecordTotal] = await Promise.all([
    teamId ? listActivePlaybooks(teamId) : Promise.resolve({ entries: [], total: 0 }),
    listPersonalMemoryIndex(userId, teamId ?? null),
    teamId ? countTeamMemoryRecords(teamId) : Promise.resolve(0),
  ])

  // ADR-0003 mode B: summary only — nothing per-entry is placed in context, so
  // there are no "recalled" ids (provenance then rests entirely on memory_get
  // fetches). Mode A (default) injects the full one-line index below.
  if (config.agent.memoryDeliveryMode === 'summary') {
    return {
      block: formatMemorySummary(team.total, personal.total, teamRecordTotal),
      teamCount: 0,
      personalCount: 0,
      teamTotal: team.total,
      personalTotal: personal.total,
      teamRecordTotal,
      teamIds: [],
      personalIds: [],
      entries: [],
    }
  }
  const blocks = [
    formatTeamIndex(team.entries, team.total),
    formatTeamRecordsNotice(teamRecordTotal),
    formatPersonalIndex(personal.entries, personal.total),
  ].filter((b): b is string => !!b)

  return {
    // Each index block carries the trust caveat for standalone renders; joined
    // into one message it only needs to appear once.
    block: blocks.length ? dedupeTrustWording(blocks.join('\n\n')) : null,
    teamCount: team.entries.length,
    personalCount: personal.entries.length,
    teamTotal: team.total,
    personalTotal: personal.total,
    teamRecordTotal,
    teamIds: team.entries.map((e) => e.memoryId),
    personalIds: personal.entries.map((e) => e.memoryId),
    entries: [
      ...team.entries.map((e) => ({
        memoryId: e.memoryId,
        scope: 'team' as const,
        kind: 'gene' as const,
        label: e.title,
        triggerSignals: e.triggerSignals,
      })),
      ...personal.entries.map((e) => ({
        memoryId: e.memoryId,
        scope: 'personal' as const,
        kind: 'record' as const,
        label: e.label,
      })),
    ],
  }
}

export async function renderMemoryContext(
  userId: string,
  teamId: string | null | undefined,
  query: string,
  conversationId?: string,
  excludeIds: readonly string[] = [],
): Promise<RenderedMemoryContext> {
  return config.agent.memoryDeliveryMode === 'automatic'
    ? renderAutomaticMemoryRecall(userId, teamId, query, conversationId, excludeIds)
    : renderMemoryIndexes(userId, teamId)
}
