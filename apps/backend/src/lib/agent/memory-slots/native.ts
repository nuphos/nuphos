// Native adapter: the in-house Playbook/Case memory implementation exposed
// through the Memory Provider SPI. This is the ONLY production file allowed to
// import lib/agent/memory-native/** (dependency rule, enforced by the
// boundaries guard test).
//
// Boundary translation: the store's legacy 'gene' vocabulary is confined to
// this file. Everything crossing the SPI speaks 'playbook' / 'record'; the
// records surface dual-emits `extra: { gene, playbook }` during the rename
// window to keep today's wire byte-compatible.

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
  // feedback / purgeUser / purgeTeam: absent — absence IS the capability
  // signal (native needs no attribution push-back; erasure ships with the
  // runtime pipeline in a later phase).
}
