// Runtime-owned memory-ingest wire frame (frontend-zero-change surface #2),
// rendered from a semantic MemorySavedEvent instead of a provider-built frame.
// Compatible with memory-native's retired buildMemorySavedFrame plus additive
// optional fields, locked by the RECORDED golden in save-frame.test.ts (the old
// builder was deleted in the PR 3 call-site swap). Desktop contract: the chip
// renders only when status==='ok' && jobStatus==='succeeded' &&
// memoriesCreated+memoriesUpdated > 0, and each memories[] entry must satisfy
// isAgentMemoryIngestEventItem.

import type { MemorySavedEvent } from './types'

export function renderMemorySavedFrame(input: {
  eventId: string
  sessionId: string
  event: MemorySavedEvent
  /** Timestamp fallback for degraded vendor events that omit createdAt/
   * updatedAt; defaults to the render moment. Native events always carry the
   * real doc timestamps (republished playbooks have createdAt ≠ updatedAt). */
  nowIso?: string
}): Record<string, unknown> {
  const { event } = input
  const nowIso = input.nowIso ?? new Date().toISOString()

  return {
    type: 'memory-ingest',
    eventId: input.eventId,
    sessionId: input.sessionId,
    status: 'ok',
    jobStatus: 'succeeded',
    // Caller contract (accumulator + dispatcher sinks): only action:'created'
    // events reach this renderer — corrections ('updated'/'superseded'),
    // vendor deletes, and pending-review drafts never render a saved chip, so
    // the fixed created/updated split below is honest by construction.
    memoriesCreated: 1,
    memoriesUpdated: 0,
    memories: [
      {
        id: event.id,
        // The frame speaks the closed compat vocabulary; vendors without a
        // `type` alias degrade to 'fact' (the chip needs SOME valid type).
        type: event.type ?? 'fact',
        title: event.title,
        // The one-line title is the honest fallback body for sparse vendor
        // events — an empty text would render a blank chip.
        text: event.text ?? event.title,
        categories: event.categories ?? [],
        scopes: [event.scope ?? 'personal'],
        createdAt: event.createdAt ?? nowIso,
        updatedAt: event.updatedAt ?? nowIso,
      },
    ],
  }
}
