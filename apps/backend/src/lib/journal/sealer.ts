// Segment sealer orchestration. Moves hot journal events into WORM storage in
// three steps, crash-safe at every boundary:
//
//   1. claim  — CAS the global seal state: allocate the next segmentId and
//               persist the exact coverage + sealedAt as `pending`. Nothing
//               has touched S3 yet; a crash leaves a pending claim behind.
//   2. upload — rebuild the body deterministically from the claimed coverage
//               (journal rows are immutable, so a rebuild after a crash is
//               byte-identical), sign the manifest, PutObject body+manifest
//               with Object Lock retention.
//   3. finalize — advance per-session sealedThrough watermarks and clear the
//               pending claim, chaining lastSegmentHash forward.
//
// On startup/next run a leftover pending claim is recovered: if the objects
// already exist in S3 the claim is finalized as-is; if not, the same segment
// is rebuilt and re-uploaded. Either way no segmentId is ever skipped and the
// same id never carries two different payloads.
//
// Storage/crypto side effects are injected (SealerDeps) so the whole state
// machine is unit-testable; concrete S3/KMS clients live in seal-scheduler.ts.

import { logEvent } from '@/lib/observability'

import {
  GLOBAL_STATE_ID,
  collectUnsealedEvents,
  eventsForCoverage,
  loadGlobalState,
  segmentBodyKey,
  segmentManifestKey,
} from './sealer-state'
import {
  GENESIS_SEGMENT_HASH,
  buildInventoryManifest,
  buildSegmentBody,
  buildSegmentManifest,
  segmentIdForCounter,
} from './segment'

import type { PendingClaim, SealResult, SealStateDoc, SealerDeps } from './sealer-state'
import type { ConversationHead, SignedSegmentManifest } from './segment'

export { SEAL_STATE_COLLECTION, segmentBodyKey, segmentManifestKey } from './sealer-state'
export type { SealResult, SealStateDoc, SealerDeps } from './sealer-state'

async function uploadAndFinalize(
  deps: SealerDeps,
  claim: PendingClaim,
): Promise<{ manifestHash: string }> {
  let body: string
  let signed: SignedSegmentManifest

  if (claim.kind === 'inventory') {
    const built = buildInventoryManifest({
      segmentId: claim.segmentId,
      prevSegmentHash: claim.prevSegmentHash,
      sealedAt: claim.sealedAt,
      heads: claim.heads ?? [],
    })

    body = built.body
    signed = built.signed
  } else {
    const events = await eventsForCoverage(deps, claim.coverage)
    const rebuilt = buildSegmentBody(events)

    body = rebuilt.body
    signed = buildSegmentManifest({
      kind: 'events',
      segmentId: claim.segmentId,
      prevSegmentHash: claim.prevSegmentHash,
      sealedAt: claim.sealedAt,
      body,
      ordered: rebuilt.ordered,
      coverage: rebuilt.coverage,
    })
  }

  if (deps.sign) {
    signed = { ...signed, signature: await deps.sign(signed.manifestHash) }
  }

  await deps.putObject(segmentBodyKey(claim.segmentId), body)
  await deps.putObject(segmentManifestKey(claim.segmentId), JSON.stringify(signed))

  // Finalize: advance watermarks, chain the global hash, clear the claim.
  if (claim.kind === 'events') {
    for (const range of claim.coverage) {
      await deps.state.updateOne(
        { _id: `s:${range.sessionId}` },
        { $set: { sealedThrough: range.toSeq } },
        { upsert: true },
      )
    }
  }
  await deps.state.updateOne(
    { _id: GLOBAL_STATE_ID },
    { $set: { lastSegmentHash: signed.manifestHash, pending: null } },
  )

  return { manifestHash: signed.manifestHash }
}

/**
 * CAS-claim the next segment. Returns null when another sealer instance won
 * the claim (the loser simply skips this run).
 */
async function claimSegment(
  deps: SealerDeps,
  global: SealStateDoc,
  claim: Omit<PendingClaim, 'segmentId' | 'prevSegmentHash'>,
): Promise<PendingClaim | null> {
  const counter = (global.segmentCounter ?? 0) + 1
  const pending: PendingClaim = {
    ...claim,
    segmentId: segmentIdForCounter(counter),
    prevSegmentHash: global.lastSegmentHash ?? GENESIS_SEGMENT_HASH,
  }
  const result = await deps.state.updateOne(
    { _id: GLOBAL_STATE_ID, segmentCounter: global.segmentCounter ?? 0, pending: null },
    { $set: { segmentCounter: counter, pending } },
  )

  if (result.matchedCount === 0) return null

  return pending
}

/** Recover a claim left behind by a crash between claim and finalize. */
async function recoverPending(deps: SealerDeps, pending: PendingClaim): Promise<void> {
  const manifestExists = await deps.objectExists(segmentManifestKey(pending.segmentId))

  logEvent('warn', 'journal.sealer.recovering_pending_segment', {
    segment_id: pending.segmentId,
    manifest_already_uploaded: manifestExists,
  })
  // The rebuild is deterministic, so recovery is the same code path whether
  // the crash hit before, during or after the upload.
  await uploadAndFinalize(deps, pending)
}

export async function sealOnce(
  deps: SealerDeps,
  options?: { maxEvents?: number },
): Promise<SealResult> {
  const maxEvents = options?.maxEvents ?? 1000
  const global = await loadGlobalState(deps.state)

  if (global.pending) {
    await recoverPending(deps, global.pending)

    return { segmentId: global.pending.segmentId, eventCount: 0, recoveredPending: true }
  }

  const events = await collectUnsealedEvents(deps, maxEvents)

  if (events.length === 0) return { segmentId: null, eventCount: 0, recoveredPending: false }

  const { coverage } = buildSegmentBody(events)
  const pending = await claimSegment(deps, global, {
    kind: 'events',
    coverage,
    sealedAt: deps.now().toISOString(),
  })

  if (!pending) return { segmentId: null, eventCount: 0, recoveredPending: false }

  await uploadAndFinalize(deps, pending)
  logEvent('info', 'journal.sealer.segment_sealed', {
    segment_id: pending.segmentId,
    event_count: events.length,
    session_count: coverage.length,
  })

  return { segmentId: pending.segmentId, eventCount: events.length, recoveredPending: false }
}

/** Daily inventory: snapshot every conversation head into the segment chain (v2 #4). */
export async function sealInventory(deps: SealerDeps): Promise<SealResult> {
  const global = await loadGlobalState(deps.state)

  if (global.pending) {
    await recoverPending(deps, global.pending)

    return { segmentId: global.pending.segmentId, eventCount: 0, recoveredPending: true }
  }

  const heads = await deps.journal
    .aggregate<{ _id: string; maxSeq: number; headHash: string }>([
      { $sort: { sessionId: 1, seq: 1 } },
      {
        $group: { _id: '$sessionId', maxSeq: { $last: '$seq' }, headHash: { $last: '$entryHash' } },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray()
  const inventoryHeads: ConversationHead[] = heads.map((head) => ({
    sessionId: head._id,
    maxSeq: head.maxSeq,
    headHash: head.headHash,
  }))

  const pending = await claimSegment(deps, global, {
    kind: 'inventory',
    coverage: [],
    heads: inventoryHeads,
    sealedAt: deps.now().toISOString(),
  })

  if (!pending) return { segmentId: null, eventCount: 0, recoveredPending: false }

  await uploadAndFinalize(deps, pending)
  logEvent('info', 'journal.sealer.inventory_sealed', {
    segment_id: pending.segmentId,
    session_count: inventoryHeads.length,
  })

  return {
    segmentId: pending.segmentId,
    eventCount: inventoryHeads.length,
    recoveredPending: false,
  }
}
