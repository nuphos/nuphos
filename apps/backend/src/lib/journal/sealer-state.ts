import { logError } from '@/lib/observability'

import { GENESIS_SEGMENT_HASH } from './segment'

import type { JournalDoc } from './append'
import type { ConversationHead, SegmentCoverage, SignedSegmentManifest } from './segment'
import type { AuditEvent } from './types'
import type { Collection } from 'mongodb'

export const SEAL_STATE_COLLECTION = 'agent_journal_seal'

export const GLOBAL_STATE_ID = '__global__'

export type PendingClaim = {
  segmentId: string
  kind: 'events' | 'inventory'
  coverage: SegmentCoverage[]
  heads?: ConversationHead[]
  sealedAt: string
  prevSegmentHash: string
}

export type SealStateDoc = {
  _id: string
  /** Global doc only. */
  segmentCounter?: number
  lastSegmentHash?: string
  pending?: PendingClaim | null
  lastAnchorAt?: string
  lastAnchoredSegmentHash?: string
  /** Per-session docs (`s:<sessionId>`) only. */
  sealedThrough?: number
}

export type SealerDeps = {
  journal: Collection<JournalDoc>
  state: Collection<SealStateDoc>
  putObject: (key: string, body: string | Uint8Array) => Promise<void>
  objectExists: (key: string) => Promise<boolean>
  sign: ((manifestHash: string) => Promise<SignedSegmentManifest['signature']>) | null
  now: () => Date
}

export type SealResult = {
  segmentId: string | null
  eventCount: number
  recoveredPending: boolean
}

export function segmentBodyKey(segmentId: string): string {
  return `segments/${segmentId}.jsonl`
}

export function segmentManifestKey(segmentId: string): string {
  return `segments/${segmentId}.manifest.json`
}

/** Materializes the global doc on first use so claims can be a plain CAS. */
export async function loadGlobalState(state: Collection<SealStateDoc>): Promise<SealStateDoc> {
  const existing = await state.findOne({ _id: GLOBAL_STATE_ID })

  if (existing) return existing
  const initial: SealStateDoc = {
    _id: GLOBAL_STATE_ID,
    segmentCounter: 0,
    lastSegmentHash: GENESIS_SEGMENT_HASH,
    pending: null,
  }

  await state.updateOne({ _id: GLOBAL_STATE_ID }, { $setOnInsert: initial }, { upsert: true })

  return (await state.findOne({ _id: GLOBAL_STATE_ID })) ?? initial
}

async function sealedThroughFor(
  state: Collection<SealStateDoc>,
  sessionId: string,
): Promise<number> {
  const doc = await state.findOne({ _id: `s:${sessionId}` })

  return doc?.sealedThrough ?? 0
}

/** Contiguous unsealed run per session, honoring the seq watermark (v2.1 #2). */
export async function collectUnsealedEvents(
  deps: SealerDeps,
  maxEvents: number,
): Promise<AuditEvent[]> {
  const sessions = await deps.journal
    .aggregate<{ _id: string; maxSeq: number }>([
      { $group: { _id: '$sessionId', maxSeq: { $max: '$seq' } } },
      { $sort: { _id: 1 } },
    ])
    .toArray()

  const collected: AuditEvent[] = []

  for (const session of sessions) {
    if (collected.length >= maxEvents) break
    const sealedThrough = await sealedThroughFor(deps.state, session._id)

    if (session.maxSeq <= sealedThrough) continue
    const docs = await deps.journal
      .find({ sessionId: session._id, seq: { $gt: sealedThrough } })
      .sort({ seq: 1 })
      .limit(maxEvents - collected.length)
      .toArray()
    let expected = sealedThrough + 1

    for (const doc of docs) {
      if (doc.seq !== expected) {
        // A hole below the tail can only mean tampering with the hot copy —
        // appends are gap-free by construction. Seal up to the hole and alarm.
        logError('journal.sealer.sequence_hole', new Error('unsealed run is not contiguous'), {
          session_id: session._id,
          expected_seq: expected,
          found_seq: doc.seq,
        })
        break
      }
      const {
        sessionId: _sessionId,
        _id,
        contentHot: _contentHot,
        ...event
      } = doc as JournalDoc & { _id?: unknown }

      collected.push(event as AuditEvent)
      expected += 1
    }
  }

  return collected
}

export async function eventsForCoverage(
  deps: SealerDeps,
  coverage: SegmentCoverage[],
): Promise<AuditEvent[]> {
  const events: AuditEvent[] = []

  for (const range of coverage) {
    const docs = await deps.journal
      .find({ sessionId: range.sessionId, seq: { $gte: range.fromSeq, $lte: range.toSeq } })
      .sort({ seq: 1 })
      .toArray()

    if (docs.length !== range.toSeq - range.fromSeq + 1) {
      throw new Error(
        `cannot rebuild pending segment: ${range.sessionId} [${String(range.fromSeq)},${String(range.toSeq)}] has ${String(docs.length)} rows`,
      )
    }
    for (const doc of docs) {
      const {
        sessionId: _sessionId,
        _id,
        contentHot: _contentHot,
        ...event
      } = doc as JournalDoc & { _id?: unknown }

      events.push(event as AuditEvent)
    }
  }

  return events
}
