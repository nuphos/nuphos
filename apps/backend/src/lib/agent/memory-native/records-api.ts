// Native backing for the /memories* REST routes (c3). Serves flat records
// (agent_memories) and Playbooks (agent_team_memories) through the EXACT wire
// contract the desktop already speaks — frontend-zero-change surface #1. Spec:
// docs/memory-poc-personal-layer-spec.md; contract verified against
// apps/desktop/src/api.ts:1992-2037 and AgentMemoriesView.tsx.

import { ObjectId } from 'mongodb'

import {
  DEFAULT_LIMIT,
  encodeNativeMemoryCursor,
  keysetFilter,
  parseNativeMemoryCursor,
  playbookToItem,
  recordToItem,
  VISIBLE_PLAYBOOK_STATUSES,
} from './records-api-items'
import { agentMemories, LIVE_RECORD_FILTER, teamMemories } from './store'

import type { NativeCursor } from './records-api-items'
import type {
  MemoryIngestEventItem,
  MemoryListItem,
  MemoryListPage,
  MemoryScope,
} from './records-api-types'

export type {
  MemoryIngestEventItem,
  MemoryIngestEventPage,
  MemoryListItem,
  MemoryListPage,
  MemoryScope,
} from './records-api-types'
export {
  encodeNativeMemoryCursor,
  keysetFilter,
  parseNativeMemoryCursor,
  playbookToItem,
} from './records-api-items'
export { deleteMemoryItem, restoreMemoryItem } from './records-api-mutations'

// A3 auto-ingest read surface: the distiller resolves after the SSE stream
// closes, so the desktop fetches this turn's learned records post-hoc (and on
// transcript reload). eventId compat: our synthesized chip ids embed the
// memory id (`<sessionId>:auto-ingest:<memoryId>`) — when present, serve just
// that record; a foreign (legacy xtrace) eventId gets an honest empty page.
export async function listAutoLearnedIngestItems(
  userId: string,
  teamId: string | null,
  conversationId: string,
  eventId?: string,
): Promise<MemoryIngestEventItem[]> {
  let onlyMemoryId: string | null = null

  if (eventId) {
    const marker = ':auto-ingest:'
    const at = eventId.indexOf(marker)

    if (at === -1) return []
    onlyMemoryId = eventId.slice(at + marker.length)
    if (!ObjectId.isValid(onlyMemoryId)) return []
  }
  const rows = await agentMemories()
    .find({
      ...LIVE_RECORD_FILTER,
      conversationId,
      source: 'auto_ingest',
      ...(onlyMemoryId ? { _id: new ObjectId(onlyMemoryId) } : {}),
      $or: [
        { scope: 'personal', ownerUserId: userId },
        ...(teamId ? [{ scope: 'team' as const, teamId }] : []),
      ],
    })
    .sort({ createdAt: 1 })
    .limit(10)
    .toArray()

  return rows.map((r) => ({
    id: r._id.toHexString(),
    type: r.type,
    ...(r.title ? { title: r.title } : {}),
    text: r.text,
    categories: r.categories,
    scopes: [r.scope],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))
}

/** Hydrate an old persisted chat chip from its durable flat record. Explicit
 * save_memory chips are not ingest snapshots, so id lookup is their only
 * post-reload detail source. */
export async function getFlatMemoryIngestItemById(
  userId: string,
  teamId: string | null,
  conversationId: string,
  memoryId: string,
): Promise<MemoryIngestEventItem | null> {
  if (!ObjectId.isValid(memoryId)) return null
  const row = await agentMemories().findOne({
    _id: new ObjectId(memoryId),
    ...LIVE_RECORD_FILTER,
    conversationId,
    $or: [
      { scope: 'personal', ownerUserId: userId },
      ...(teamId ? [{ scope: 'team' as const, teamId }] : []),
    ],
  })

  if (!row) return null

  return {
    id: row._id.toHexString(),
    type: row.type,
    ...(row.title ? { title: row.title } : {}),
    text: row.text,
    categories: row.categories,
    scopes: [row.scope],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ── List (GET /memories) ────────────────────────────────────────────────
// Personal scope mirrors the xtrace pool semantics exactly: a personal
// memory is scoped to (user, team) — team-context personal and solo are
// distinct pools, so filter teamId: teamId ?? null.

export async function listMemoryItems(
  userId: string,
  opts: {
    cursor?: string
    limit?: number
    teamId?: string
    scope?: MemoryScope
    state?: 'live' | 'removed'
  } = {},
): Promise<MemoryListPage> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? DEFAULT_LIMIT))
  const removed = opts.state === 'removed'
  const recordStateFilter = removed ? { disabledAt: { $exists: true } } : LIVE_RECORD_FILTER
  const playbookStatusFilter = removed ? ['rejected' as const] : [...VISIBLE_PLAYBOOK_STATUSES]

  if (opts.scope === 'team') {
    if (!opts.teamId) return { enabled: true, memories: [], nextCursor: null, hasMore: false }
    const cursor = parseNativeMemoryCursor(opts.cursor)
    const items: MemoryListItem[] = []

    // Playbooks first — the curated entries lead, like xtrace's shared pool did.
    if (!cursor.gd) {
      const playbooks = await teamMemories()
        .find({
          teamId: opts.teamId,
          status: { $in: playbookStatusFilter },
          ...keysetFilter('updatedAt', cursor.g),
        })
        .sort({ updatedAt: -1, _id: -1 })
        .limit(limit)
        .toArray()

      items.push(...playbooks.map((g) => playbookToItem(g)))
      const last = playbooks[playbooks.length - 1]

      cursor.g = last ? { t: last.updatedAt.toISOString(), id: last._id.toHexString() } : cursor.g
      if (playbooks.length < limit) cursor.gd = true
    }

    const remaining = limit - items.length

    if (!cursor.rd && remaining > 0) {
      const records = await agentMemories()
        .find({
          scope: 'team',
          teamId: opts.teamId,
          ...recordStateFilter,
          ...keysetFilter('createdAt', cursor.r),
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(remaining)
        .toArray()

      items.push(...records.map(recordToItem))
      const last = records[records.length - 1]

      cursor.r = last ? { t: last.createdAt.toISOString(), id: last._id.toHexString() } : cursor.r
      if (records.length < remaining) cursor.rd = true
    }

    return {
      enabled: true,
      memories: items,
      nextCursor: encodeNativeMemoryCursor(cursor),
      hasMore: !(cursor.gd && cursor.rd),
    }
  }

  // Personal scope: single source, plain keyset cursor.
  const cursor = parseNativeMemoryCursor(opts.cursor)
  const query = {
    scope: 'personal' as const,
    ownerUserId: userId,
    teamId: opts.teamId ?? null,
    ...recordStateFilter,
    ...keysetFilter('createdAt', cursor.r),
  }
  const records = await agentMemories()
    .find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .toArray()
  const last = records[records.length - 1]
  const next: NativeCursor = {
    g: null,
    gd: true,
    r: last ? { t: last.createdAt.toISOString(), id: last._id.toHexString() } : cursor.r,
    rd: records.length < limit,
  }

  return {
    enabled: true,
    memories: records.map(recordToItem),
    nextCursor: encodeNativeMemoryCursor(next),
    hasMore: records.length === limit,
  }
}

// ── Get one (GET /memories/:memoryId) ───────────────────────────────────

export async function getMemoryItem(
  userId: string,
  memoryId: string,
  opts: { teamId?: string; scope?: MemoryScope } = {},
): Promise<MemoryListItem | null> {
  if (!ObjectId.isValid(memoryId)) return null
  const _id = new ObjectId(memoryId)

  if (opts.scope === 'team') {
    if (!opts.teamId) return null
    const record = await agentMemories().findOne({
      _id,
      scope: 'team',
      teamId: opts.teamId,
      ...LIVE_RECORD_FILTER,
    })

    if (record) return recordToItem(record)
    const playbook = await teamMemories().findOne({
      _id,
      teamId: opts.teamId,
      status: { $in: [...VISIBLE_PLAYBOOK_STATUSES] },
    })

    return playbook ? playbookToItem(playbook, { includeCapsules: true }) : null
  }
  const record = await agentMemories().findOne({
    _id,
    scope: 'personal',
    ownerUserId: userId,
    teamId: opts.teamId ?? null,
    ...LIVE_RECORD_FILTER,
  })

  return record ? recordToItem(record) : null
}

// The SSE save-feedback frame builder (buildMemorySavedFrame) retired with
// the Phase 2 PR 3 call-site swap: providers emit semantic MemorySavedEvents
// and the RUNTIME renders the wire memory-ingest frame
// (memory-slots/save-frame.ts, golden-locked by save-frame.test.ts).
