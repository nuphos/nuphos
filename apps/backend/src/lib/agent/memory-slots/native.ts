// Native adapter: the in-house Playbook/Case memory implementation exposed
// through the Memory Provider SPI. This is the ONLY production file allowed to
// import lib/agent/memory-native/** (dependency rule, enforced by the
// boundaries guard test). Phase 1 is parallel plumbing: nothing routes through
// this adapter yet — the call-site swap is Phase 2.
//
// Boundary translation: the store's legacy 'gene' vocabulary is confined to
// this file. Everything crossing the SPI speaks 'playbook' / 'record'; the
// records surface dual-emits `extra: { gene, playbook }` during the rename
// window to keep today's wire byte-compatible.

import { config } from '@/config'
import { logError } from '@/lib/observability'

import { renderMemoryContext } from '../memory-native/index'
import { onTurnFinished } from '../memory-native/ingest-turn'
import {
  deleteMemoryItem,
  getMemoryItem,
  listMemoryItems,
  restoreMemoryItem,
} from '../memory-native/records-api'
import { setupTeamMemoryIndexes } from '../memory-native/store'
import { createTeamMemoryTools } from '../memory-native/tools'

import { MEMORY_SPI_VERSION } from './types'

import type {
  MemoryProvider,
  MemoryRecordItem,
  MemoryScope,
  MemoryTool,
  MemoryToolContext,
  RenderedMemoryContext,
} from './types'
import type { MemoryListItem } from '../memory-native/records-api'

// ── Records mapping ─────────────────────────────────────────────────────────

function toRecordItem(item: MemoryListItem): MemoryRecordItem {
  return {
    id: item.id,
    // Open vocabulary primary; the closed enum rides along as compat alias.
    kind: item.gene ? 'playbook' : 'record',
    type: item.type,
    ...(item.title ? { title: item.title } : {}),
    text: item.text,
    categories: item.categories,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    convId: item.convId,
    userId: item.userId,
    appId: item.appId,
    groupIds: item.groupIds,
    ...(item.disabledAt ? { disabledAt: item.disabledAt } : {}),
    ...(item.disabledBy ? { disabledBy: item.disabledBy } : {}),
    // Structured payload spreads verbatim onto the wire ({ ...core, ...extra }):
    // `gene` keeps today's field byte-compatible, `playbook` dual-emits the
    // new name during the rename window. disabledReason has no neutral-core
    // slot — it rides extra so state=removed listings keep their reason.
    ...(item.gene || item.disabledReason
      ? {
          extra: {
            ...(item.gene ? { gene: item.gene, playbook: item.gene } : {}),
            ...(item.disabledReason ? { disabledReason: item.disabledReason } : {}),
          },
        }
      : {}),
  }
}

// ── Observer bridging ────────────────────────────────────────────────────────

/** Semantic MemorySavedEvent from the tool layer's item/scope pair — no more
 * round-tripping through the wire frame (Phase 2): the runtime renders the
 * frame FROM this event, so it carries the real doc timestamps (a republished
 * playbook has createdAt ≠ updatedAt). Wire parity with the retired
 * frame-parse path is locked by save-frame.test.ts. */
function savedEventFromItem(scope: MemoryScope, item: MemoryListItem, title?: string) {
  const firstLine = item.text.split('\n', 1)[0] ?? ''

  return {
    id: item.id,
    scope,
    // The native tool layer only saves playbooks at team scope and flat
    // records at personal scope, so scope determines the kind.
    kind: scope === 'team' ? 'playbook' : 'record',
    // Real one-line label when the tool layer knows it (save_memory mandates
    // title); body-prefix only as the degraded fallback.
    title: title ?? item.title ?? firstLine.slice(0, 160),
    action: 'created' as const,
    type: item.type,
    text: item.text,
    categories: item.categories,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

// ── The provider bundle ──────────────────────────────────────────────────────
// The ingest slot's onTurnFinished lives in ../memory-native/ingest-turn.

export const nativeMemoryProvider: MemoryProvider = {
  meta: {
    id: 'native',
    displayName: 'Nuphos Memory',
    dataResidency: 'local',
    spiVersion: MEMORY_SPI_VERSION,
  },
  // Declared for the boot assertion; the shipped stores predate the SPI and
  // are grandfathered under their agent_* names (A5⑧) — storageDescriptor is
  // the authoritative manifest.
  collectionPrefix: 'memory_native_',
  storageDescriptor: () => ({
    kind: 'mongo',
    collections: ['agent_team_memories', 'agent_team_memory_proposals', 'agent_memories'],
  }),
  setup: () => setupTeamMemoryIndexes(),
  // Needs no keys; Mongo-up is the process's own liveness.
  availability: async () => ({ state: 'ready' }),

  recall: {
    // Never throws (conformance item 7): a failing store yields "no context",
    // not an exception into the turn — the runtime treats null as no-op.
    render: async (input, opts): Promise<RenderedMemoryContext | null> => {
      try {
        // Cheap early-out on an already-expired budget; native's Mongo reads
        // are fast enough that mid-flight cancellation buys nothing (A5④).
        if (opts?.signal?.aborted) return null
        const rendered = await renderMemoryContext(
          input.userId,
          input.teamId,
          input.query ?? '',
          input.conversationId,
          input.excludeIds,
        )
        const diagnostics: Record<string, number | string | boolean> = {
          teamCount: rendered.teamCount,
          personalCount: rendered.personalCount,
          ...(rendered.teamTotal !== undefined ? { teamTotal: rendered.teamTotal } : {}),
          ...(rendered.personalTotal !== undefined
            ? { personalTotal: rendered.personalTotal }
            : {}),
          ...(rendered.teamRecordTotal !== undefined
            ? { teamRecordTotal: rendered.teamRecordTotal }
            : {}),
        }

        return {
          block: rendered.block,
          recalled: rendered.entries.map((entry) => ({
            id: entry.memoryId,
            scope: entry.scope,
            kind: entry.kind === 'gene' ? 'playbook' : 'record',
            label: entry.label,
          })),
          diagnostics,
          // 'automatic' delivery appends compact matches to the last user
          // message (A5⑤); the index/summary modes inject a system block.
          placement:
            config.agent.memoryDeliveryMode === 'automatic' ? 'user-message-tail' : 'system-block',
        }
      } catch (err) {
        logError('memory.native.recall_failed', err, { userId: input.userId })

        return null
      }
    },
  },

  tools: {
    create: (ctx: MemoryToolContext) =>
      createTeamMemoryTools({
        userId: ctx.userId,
        teamId: ctx.teamId,
        conversationId: ctx.conversationId,
        origin: ctx.origin,
        getActivePlanId: ctx.getActivePlanId,
        onMemorySavedItem: ({ scope, item, title }) => {
          ctx.observer.saved(savedEventFromItem(scope, item, title))
        },
        onMemoryFetched: (memoryId, kind, scope, label) => {
          ctx.observer.fetched({
            id: memoryId,
            scope,
            kind: kind === 'gene' ? 'playbook' : 'record',
            // Fetch-time snapshot: the attribution judge's candidate content
            // for fetched-only memories (A4① — never re-read from the store).
            label,
          })
        },
        // The tool layer fires supersede BEFORE the saved frame (and alone on
        // the dedup path), so pairing it into the new memory's supersededId
        // is not order-safe — emit a standalone lifecycle event instead, with
        // id === supersededId per the MemorySavedEvent contract (the retired
        // memory is the subject; the successor is unknown here). The runtime
        // keys the supersede_correction signal off supersededId, never id.
        onMemorySuperseded: (memoryId, scope) => {
          ctx.observer.saved({
            id: memoryId,
            scope,
            kind: scope === 'team' ? 'playbook' : 'record',
            title: '',
            action: 'superseded',
            supersededId: memoryId,
          })
        },
        onMemorySearched: (info) => {
          ctx.observer.searched({
            query: info.query,
            hitCount: info.hitCount + info.playbookHitCount,
            hitsByKind: { record: info.hitCount, playbook: info.playbookHitCount },
          })
        },
      }) as Record<string, MemoryTool>,
  },

  ingest: { onTurnFinished },

  records: {
    cursorTier: 'strict',
    list: async (input) => {
      const page = await listMemoryItems(input.viewer.userId, {
        cursor: input.cursor ?? undefined,
        limit: input.limit,
        teamId: input.viewer.teamId ?? undefined,
        scope: input.viewer.scope,
        state: input.state,
      })

      return {
        items: page.memories.map(toRecordItem),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      }
    },
    get: async (id, viewer) => {
      const item = await getMemoryItem(viewer.userId, id, {
        teamId: viewer.teamId ?? undefined,
        scope: viewer.scope,
      })

      return item ? toRecordItem(item) : null
    },
    delete: (id, viewer, opts) =>
      deleteMemoryItem(viewer.userId, id, {
        teamId: viewer.teamId ?? undefined,
        scope: viewer.scope,
        reason: opts?.reason,
      }),
    restore: (id, viewer) =>
      restoreMemoryItem(viewer.userId, id, {
        teamId: viewer.teamId ?? undefined,
        scope: viewer.scope,
      }),
  },
  // feedback / webhook / purgeUser / purgeTeam: absent — absence IS the
  // capability signal (native needs no attribution push-back or vendor
  // webhook; erasure ships with the runtime pipeline in a later phase).
}
