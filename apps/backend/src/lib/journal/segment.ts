// Sealed segment model. Segments carry journal events from the hot Mongo copy
// into WORM storage:
//
//   - body: JSONL, one canonicalized AuditEvent per line, ordered by
//     (sessionId, seq)
//   - coverage: per-session contiguous [fromSeq, toSeq] watermarks (v2.1 #2 —
//     seq ranges, never timestamps, so segment boundaries stay verifiable
//     under clock skew, retries and late writes)
//   - manifest: hashes of body + every event, chained to the previous
//     segment's manifestHash (a second, global chain above the per-
//     conversation chains)
//   - daily inventory segments snapshot every conversation head so the
//     deletion of an entire conversation is detectable (v2 #4)
//
// Everything here is pure — S3/KMS orchestration lives in sealer.ts.

import { canonicalize } from './canonical'
import { digestEquals, sha256Hex } from './hashing'

import type { AuditEvent, JsonValue } from './types'

export const SEGMENT_SCHEMA_VERSION = 1 as const

/** prevSegmentHash of the first segment in the global chain. */
export const GENESIS_SEGMENT_HASH = '0'.repeat(64)

export type SegmentCoverage = { sessionId: string; fromSeq: number; toSeq: number }

export type ConversationHead = { sessionId: string; maxSeq: number; headHash: string }

export type SegmentManifest = {
  v: typeof SEGMENT_SCHEMA_VERSION
  kind: 'events' | 'inventory'
  segmentId: string
  prevSegmentHash: string
  sealedAt: string
  eventCount: number
  coverage: SegmentCoverage[]
  bodyHash: string
  eventHashes: string[]
}

export type SegmentSignature = {
  alg: string
  keyId: string
  signatureBase64: string
}

export type SignedSegmentManifest = {
  manifest: SegmentManifest
  /** sha256 hex of canonicalize(manifest); the value the signature covers. */
  manifestHash: string
  signature: SegmentSignature | null
}

export function segmentIdForCounter(counter: number): string {
  return `seg-${String(counter).padStart(8, '0')}`
}

function sortEvents(events: AuditEvent[]): AuditEvent[] {
  return [...events].sort((a, b) =>
    a.session.conversationId === b.session.conversationId
      ? a.seq - b.seq
      : a.session.conversationId < b.session.conversationId
        ? -1
        : 1,
  )
}

/** Strip storage-side fields; only canonical AuditEvent fields enter the body. */
function toCanonicalEvent(event: AuditEvent): JsonValue {
  return {
    v: event.v,
    eventId: event.eventId,
    seq: event.seq,
    ts: event.ts,
    type: event.type,
    actor: { userId: event.actor.userId, teamId: event.actor.teamId },
    session: {
      conversationId: event.session.conversationId,
      requestId: event.session.requestId,
      streamId: event.session.streamId,
      toolCallId: event.session.toolCallId,
      modelId: event.session.modelId,
    },
    payload: event.payload,
    payloadHash: event.payloadHash,
    prevHash: event.prevHash,
    entryHash: event.entryHash,
  }
}

/** Deterministic JSONL body — same events in, byte-identical body out. */
export function buildSegmentBody(events: AuditEvent[]): {
  body: string
  ordered: AuditEvent[]
  coverage: SegmentCoverage[]
} {
  const ordered = sortEvents(events)
  const lines = ordered.map((event) => canonicalize(toCanonicalEvent(event)))
  const coverage: SegmentCoverage[] = []

  for (const event of ordered) {
    const sessionId = event.session.conversationId
    const last = coverage.at(-1)

    if (last && last.sessionId === sessionId) {
      if (event.seq !== last.toSeq + 1) {
        throw new Error(
          `segment coverage must be contiguous: ${sessionId} jumps ${String(last.toSeq)} -> ${String(event.seq)}`,
        )
      }
      last.toSeq = event.seq
    } else {
      if (coverage.some((c) => c.sessionId === sessionId)) {
        throw new Error(`segment events for ${sessionId} are not grouped contiguously`)
      }
      coverage.push({ sessionId, fromSeq: event.seq, toSeq: event.seq })
    }
  }

  return { body: lines.join('\n') + (lines.length > 0 ? '\n' : ''), ordered, coverage }
}

export function buildSegmentManifest(input: {
  kind: 'events' | 'inventory'
  segmentId: string
  prevSegmentHash: string
  sealedAt: string
  body: string
  ordered: AuditEvent[]
  coverage: SegmentCoverage[]
}): SignedSegmentManifest {
  const manifest: SegmentManifest = {
    v: SEGMENT_SCHEMA_VERSION,
    kind: input.kind,
    segmentId: input.segmentId,
    prevSegmentHash: input.prevSegmentHash,
    sealedAt: input.sealedAt,
    eventCount: input.ordered.length,
    coverage: input.coverage,
    bodyHash: sha256Hex(input.body),
    eventHashes: input.ordered.map((event) => event.entryHash),
  }

  return {
    manifest,
    manifestHash: sha256Hex(canonicalize(manifest as unknown as JsonValue)),
    signature: null,
  }
}

/** Inventory bodies reuse the segment pipeline: one canonical JSON line per head. */
export function buildInventoryBody(heads: ConversationHead[]): string {
  const sorted = [...heads].sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))
  const lines = sorted.map((head) =>
    canonicalize({ sessionId: head.sessionId, maxSeq: head.maxSeq, headHash: head.headHash }),
  )

  return lines.join('\n') + (lines.length > 0 ? '\n' : '')
}

export function buildInventoryManifest(input: {
  segmentId: string
  prevSegmentHash: string
  sealedAt: string
  heads: ConversationHead[]
}): { body: string; signed: SignedSegmentManifest } {
  const body = buildInventoryBody(input.heads)
  const manifest: SegmentManifest = {
    v: SEGMENT_SCHEMA_VERSION,
    kind: 'inventory',
    segmentId: input.segmentId,
    prevSegmentHash: input.prevSegmentHash,
    sealedAt: input.sealedAt,
    eventCount: input.heads.length,
    coverage: input.heads.map((head) => ({
      sessionId: head.sessionId,
      fromSeq: head.maxSeq,
      toSeq: head.maxSeq,
    })),
    bodyHash: sha256Hex(body),
    eventHashes: input.heads
      .slice()
      .sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))
      .map((head) => head.headHash),
  }

  return {
    body,
    signed: {
      manifest,
      manifestHash: sha256Hex(canonicalize(manifest as unknown as JsonValue)),
      signature: null,
    },
  }
}

export type SegmentViolation = { code: string; message: string }

/** Recompute one sealed segment against its body and chain position. */
export function verifySegment(input: {
  signed: SignedSegmentManifest
  body: string
  expectedPrevSegmentHash: string | null
}): SegmentViolation[] {
  const violations: SegmentViolation[] = []
  const { manifest, manifestHash } = input.signed

  const recomputedManifestHash = sha256Hex(canonicalize(manifest as unknown as JsonValue))

  if (!digestEquals(recomputedManifestHash, manifestHash)) {
    violations.push({
      code: 'manifest_hash_mismatch',
      message: `${manifest.segmentId}: manifest does not hash to recorded manifestHash`,
    })
  }
  if (!digestEquals(sha256Hex(input.body), manifest.bodyHash)) {
    violations.push({
      code: 'body_hash_mismatch',
      message: `${manifest.segmentId}: body does not hash to manifest.bodyHash`,
    })
  }
  if (
    input.expectedPrevSegmentHash !== null &&
    manifest.prevSegmentHash !== input.expectedPrevSegmentHash
  ) {
    violations.push({
      code: 'broken_segment_link',
      message: `${manifest.segmentId}: prevSegmentHash does not match previous segment`,
    })
  }

  const lines = input.body.split('\n').filter((line) => line.length > 0)

  if (lines.length !== manifest.eventCount) {
    violations.push({
      code: 'event_count_mismatch',
      message: `${manifest.segmentId}: body has ${String(lines.length)} lines, manifest says ${String(manifest.eventCount)}`,
    })
  }
  if (manifest.kind === 'events') {
    lines.forEach((line, i) => {
      let entryHash: string | undefined

      try {
        entryHash = (JSON.parse(line) as { entryHash?: string }).entryHash
      } catch {
        violations.push({
          code: 'body_line_unparseable',
          message: `${manifest.segmentId}: line ${String(i + 1)} is not valid JSON`,
        })

        return
      }
      if (entryHash !== manifest.eventHashes[i]) {
        violations.push({
          code: 'event_hash_mismatch',
          message: `${manifest.segmentId}: line ${String(i + 1)} entryHash differs from manifest.eventHashes[${String(i)}]`,
        })
      }
    })
  }

  return violations
}
