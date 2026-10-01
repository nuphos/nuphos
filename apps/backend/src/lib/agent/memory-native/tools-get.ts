import { tool } from 'ai'
import { z } from 'zod'

import { config } from '@/config'

import { rerankCandidates } from './rerank'
import {
  getMemoryRecord,
  getTeamMemory,
  recordMemoryFetches,
  recordPlaybookFetch,
  searchMemoryRecords,
  searchTeamPlaybooks,
} from './store'
import { label } from './tools-shared'

import type { MemoryFetchedObserver, MemorySearchedObserver } from './tools-shared'

export function createMemoryGetTool(deps: {
  userId: string
  teamId: string | null | undefined
  /** Attributes the optional rerank model call's token usage to the real
   *  conversation rather than a synthetic per-user session. */
  conversationId?: string
  onMemoryFetched?: MemoryFetchedObserver
  onMemorySearched?: MemorySearchedObserver
}) {
  const { userId, teamId, conversationId, onMemoryFetched, onMemorySearched } = deps

  return tool({
    description:
      'Load a memory by `memoryId` (from the Team experience or Saved memories index) OR search the full memory pool by `query`. ' +
      'The indexes show only the most recent entries; when a relevant memory may exist but is not listed, search with `query` (keyword full-text over every saved memory AND team experience entry you can read, including older/imported ones) instead of assuming none exists. ' +
      'Write the query as English keywords — most memories are stored in English; add the Chinese term too only when you expect it verbatim (error strings, product names). ' +
      'If a search returns nothing, retry once with different or broader keywords before concluding no memory exists. ' +
      'Team experience matches come back as one-line summaries — load the full strategy with memory_get(memoryId). ' +
      'Re-verify against live state before applying — it is historical experience, not current truth.',
    inputSchema: z
      .object({
        label,
        memoryId: z.string().optional().describe('Exact id to load. Omit when searching.'),
        query: z
          .string()
          .optional()
          .describe(
            'Keyword search across the full readable memory pool. Omit when loading a known id.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Max search results (default 8).'),
        tags: z
          .array(z.string().max(40))
          .max(5)
          .optional()
          .describe('Search only: narrow to records carrying ALL these tags.'),
        scope: z
          .enum(['personal', 'team'])
          .optional()
          .describe('Search only: restrict to one pool when you know where the memory lives.'),
      })
      .refine((v) => Boolean(v.memoryId) !== Boolean(v.query), {
        message: 'Provide exactly one of memoryId or query.',
      }),
    execute: async (input) => {
      if (input.query) {
        const limit = input.limit ?? 8
        const filters = { tags: input.tags, scope: input.scope }
        // Rung 1.5 (flagged): pull a wider lexical candidate set, let the
        // small model reorder it, return the top `limit`. Fails open to
        // lexical order inside rerankCandidates.
        const rerank = config.agent.memoryRerankEnabled
        const [rawHits, playbookHits] = await Promise.all([
          searchMemoryRecords(
            userId,
            teamId,
            input.query,
            rerank ? Math.max(20, limit) : limit,
            filters,
          ),
          // Playbook hits are summaries (title + signals), not full bodies —
          // loading one by id is what counts as a fetch. A personal-only
          // search honors its scope filter and skips playbooks entirely.
          teamId && input.scope !== 'personal'
            ? searchTeamPlaybooks(teamId, input.query)
            : Promise.resolve([]),
        ])
        const hits = rerank
          ? (
              await rerankCandidates(
                input.query,
                rawHits.map((h) => ({
                  ...h,
                  memoryId: h._id.toHexString(),
                  label: h.title || h.text.slice(0, 160),
                })),
                { userId, teamId, sessionId: conversationId },
              )
            ).slice(0, limit)
          : rawHits

        onMemorySearched?.({
          query: input.query,
          hitCount: hits.length,
          playbookHitCount: playbookHits.length,
        })
        for (const h of hits)
          onMemoryFetched?.(h._id.toHexString(), 'record', h.scope, h.title || h.text.slice(0, 160))
        // Rung 0.5: search hits return full record bodies, so they count as
        // fetches. Fire-and-forget — a lost bump must never block the turn.
        void recordMemoryFetches(hits.map((h) => h._id)).catch(() => {})

        return {
          ok: true,
          kind: 'search',
          query: input.query,
          results: hits.map((h) => ({
            memoryId: h._id.toHexString(),
            scope: h.scope,
            type: h.type,
            ...(h.title ? { title: h.title } : {}),
            text: h.text,
            categories: h.categories,
            source: h.source,
            // ISO strings, not Date instances: tool outputs are persisted
            // into the transcript and replayed through ModelMessage's JSON
            // schema — a live Date poisons every later turn of the session.
            createdAt: h.createdAt.toISOString(),
            updatedAt: h.updatedAt.toISOString(),
          })),
          ...(playbookHits.length
            ? {
                teamExperience: playbookHits.map((g) => ({
                  memoryId: g.memoryId,
                  title: g.title,
                  triggerSignals: g.triggerSignals,
                })),
              }
            : {}),
        }
      }
      const memoryId = input.memoryId! // refine guarantees id when query is absent
      const rawPlaybook = teamId ? await getTeamMemory(teamId, memoryId) : null
      // Tombstoned playbooks are invisible everywhere else (index, list, get
      // route) — the tool must not resurrect them either.
      const playbook =
        rawPlaybook && (rawPlaybook.status === 'active' || rawPlaybook.status === 'needs_review')
          ? rawPlaybook
          : null

      if (playbook) {
        onMemoryFetched?.(memoryId, 'gene', 'team', playbook.gene.title)
        void recordPlaybookFetch(teamId!, memoryId).catch(() => {})

        return {
          ok: true,
          memoryId,
          kind: 'gene',
          status: playbook.status,
          revision: playbook.revision,
          gene: playbook.gene,
          capsules: playbook.capsules.map((c) => ({
            outcome: c.outcome,
            problem: c.problem,
            rootCause: c.rootCause,
            actions: c.actions,
            verification: c.verification,
            conversationId: c.conversationId,
            observedAt: c.observedAt.toISOString(),
          })),
        }
      }
      const record = await getMemoryRecord(memoryId, userId, teamId)

      if (!record) return { ok: false, error: 'memory not found' }
      onMemoryFetched?.(memoryId, 'record', record.scope, record.title || record.text.slice(0, 160))
      void recordMemoryFetches([record._id]).catch(() => {})

      return {
        ok: true,
        memoryId,
        kind: 'record',
        scope: record.scope,
        type: record.type,
        ...(record.title ? { title: record.title } : {}),
        text: record.text,
        categories: record.categories,
        source: record.source,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      }
    },
  })
}
