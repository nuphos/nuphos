import {
  getFlatMemoryIngestItemById,
  listAutoLearnedIngestItems,
} from '@/lib/agent/memory-native/records-api'
import { parseMemoryIngestEventId } from '@/lib/agent/memory-slots/ingest-event-id'
import {
  getIngestEventSnapshot,
  listIngestEventSnapshots,
} from '@/lib/agent/memory-slots/ingest-events'
import { listMemoriesWire, restoreMemoryWire } from '@/lib/agent/memory-slots/records-wire'
import { AppError } from '@/lib/errors'

import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import type { MemorySavedEvent, MemoryScope } from '@/lib/agent/memory-slots/types'
import type { Context } from 'hono'

// Memory records list — scoped to the authenticated user in the current team
// context across all conversations. Phase 2: served through the memory-slots
// SPI (global-default provider, no team override yet). Bodies stay
// compatible with the direct records-api era plus sanctioned additive fields:
// top-level `provider`, per-item `kind`, and optional flat-record `title`.
export function readMemoryScope(c: Context): MemoryScope {
  const scope = c.req.query('scope')

  if (scope === 'team') return 'team'

  return 'personal'
}

export function memoryViewer(userId: string, teamId: string | undefined, scope: MemoryScope) {
  return { userId, teamId: teamId ?? null, scope }
}

async function readIngestSnapshots(sessionId: string, turnKey: string | undefined) {
  if (!turnKey) {
    return { exactSnapshot: undefined, snapshots: await listIngestEventSnapshots(sessionId) }
  }
  const exactSnapshot = await getIngestEventSnapshot(sessionId, turnKey)

  return { exactSnapshot, snapshots: exactSnapshot ? [exactSnapshot] : [] }
}

agent.get('/memories', async (c) => {
  const userId = c.get('userId')
  const cursor = c.req.query('cursor') ?? undefined
  const limitParam = c.req.query('limit')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const scope = readMemoryScope(c)
  let limit: number | undefined

  if (limitParam != null) {
    const parsed = Number(limitParam)

    if (!Number.isFinite(parsed)) {
      throw new AppError(400, 'invalid_request', 'limit must be a number')
    }
    limit = Math.max(1, Math.min(100, Math.trunc(parsed)))
  }
  // state=removed lists tombstoned items (with disabledAt/disabledBy) for the
  // ADR-0005 restore flow; anything else means live (default).
  const state = c.req.query('state') === 'removed' ? ('removed' as const) : undefined
  const body = await listMemoriesWire(memoryViewer(userId, teamId, scope), {
    cursor,
    limit,
    ...(state ? { state } : {}),
  })

  // Boot asserts the global default provider is registered; null survives
  // only a mid-process registry mutation.
  if (!body) throw new AppError(503, 'memory_unavailable', 'Memory provider unavailable')

  return c.json(body)
})

agent.post('/memories/:memoryId/restore', async (c) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const scope = readMemoryScope(c)
  // A provider without a restore surface 404s here too (SPI contract: the
  // desktop hides the affordance when the capability is absent).
  const restored = await restoreMemoryWire(
    memoryViewer(userId, teamId, scope),
    c.req.param('memoryId'),
  )

  if (!restored) throw new AppError(503, 'memory_unavailable', 'Memory provider unavailable')
  if (!restored.ok)
    throw new AppError(404, 'not_found', 'Memory not found or not restorable by you')

  return c.json({ ok: true, provider: restored.provider })
})

agent.get('/memories/ingest/:sessionId', async (c) => {
  // A3 auto-ingest: the ingest slot resolves after the SSE stream closes, so
  // the desktop fetches this turn's learned records here post-hoc (and by
  // eventId when a persisted chip is expanded without inline details). Served
  // from the runtime's durable IngestOutcome snapshots
  // (memory_runtime_ingest_events) — provider-neutral, written by
  // dispatchTurnIngest from this deploy onward. Legacy xtrace-era chips
  // (foreign eventId shape) still get an honest empty page.
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const sessionId = c.req.param('sessionId')
  const eventId = c.req.query('eventId') ?? undefined
  const turnKey = c.req.query('turnKey') ?? undefined
  // Persisted transcripts retain three generations of chip ids: turn-key
  // polling ids, auto-ingest memory ids, and explicit save_memory ids.
  let onlyMemoryId: string | null = null
  let snapshotTurnKey = turnKey

  if (eventId) {
    const selector = parseMemoryIngestEventId(eventId)

    if (!selector) return c.json({ enabled: true, status: 'ok', memories: [] })
    if (selector.kind === 'turn') snapshotTurnKey ??= selector.turnKey
    else onlyMemoryId = selector.memoryId
  }
  const { exactSnapshot, snapshots } = await readIngestSnapshots(sessionId, snapshotTurnKey)
  // Tenancy mirrors the legacy Mongo filter: personal-scope items only for
  // their owner, team-scope items only inside the verified team context.
  const visible = (snapshot: { userId: string; teamId: string | null }, scope: MemoryScope) =>
    scope === 'personal'
      ? snapshot.userId === userId
      : teamId !== undefined && snapshot.teamId === teamId
  const memories = snapshots.flatMap((snapshot) =>
    snapshot.saved
      // Only live creations are learned records (corrections/drafts/vendor
      // deletes never rendered a chip — same rule as the frame sinks).
      .filter((event: MemorySavedEvent) => event.action === 'created')
      .filter((event: MemorySavedEvent) => !onlyMemoryId || event.id === onlyMemoryId)
      .filter((event: MemorySavedEvent) => visible(snapshot, event.scope ?? 'personal'))
      .map((event: MemorySavedEvent) => ({
        // Legacy MemoryIngestEventItem wire shape plus optional title.
        id: event.id,
        type: event.type ?? 'fact',
        title: event.title,
        text: event.text ?? event.title,
        categories: event.categories ?? [],
        scopes: [event.scope ?? 'personal'],
        createdAt: event.createdAt ?? snapshot.at.toISOString(),
        updatedAt: event.updatedAt ?? snapshot.at.toISOString(),
      })),
  )

  // Historical fallback (REMOVAL TRIGGER: delete after one release cycle,
  // together with the listAutoLearnedIngestItems import and its boundaries
  // grandfather): conversations from before this deploy have no snapshot
  // rows, but the desktop's MemoryIngestPartView still fetches them by
  // eventId when a persisted chip lacks inline details. Also covers a
  // pre-deploy chip inside a mixed-era conversation (snapshots exist, but
  // none carries the requested memory id).
  if (memories.length === 0 && onlyMemoryId) {
    const item = await getFlatMemoryIngestItemById(userId, teamId ?? null, sessionId, onlyMemoryId)

    if (item) return c.json({ enabled: true, status: 'ok', memories: [item] })
  }
  if (!snapshotTurnKey && memories.length === 0 && snapshots.length === 0) {
    const legacy = await listAutoLearnedIngestItems(userId, teamId ?? null, sessionId, eventId)

    return c.json({ enabled: true, status: 'ok', memories: legacy })
  }

  // No durable row yet means this exact turn's asynchronous distiller is
  // still allowed to settle. The client uses a bounded poll, so disabled or
  // failed ingest cannot leave the UI spinning forever.
  const status = snapshotTurnKey && exactSnapshot?.status !== 'completed' ? 'pending' : 'ok'

  return c.json({ enabled: true, status, memories })
})
