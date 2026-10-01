import { KMSClient, VerifyCommand } from '@aws-sdk/client-kms'
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'

import { config } from '../src/config'
import { db } from '../src/lib/db'
import { JOURNAL_COLLECTION } from '../src/lib/journal'
import { SEAL_STATE_COLLECTION } from '../src/lib/journal/sealer'
import { GENESIS_SEGMENT_HASH, verifySegment } from '../src/lib/journal/segment'

import type { JournalDoc } from '../src/lib/journal'
import type { SealStateDoc } from '../src/lib/journal/sealer'
import type { SignedSegmentManifest } from '../src/lib/journal/segment'

export type ReportFn = (severity: 'HARD' | 'SOFT', scope: string, message: string) => void

export async function verifySealedSegments(report: ReportFn): Promise<number> {
  let checkedSegments = 0
  const bucket = config.journal.s3Bucket

  if (!bucket) {
    console.log('· sealed-segment pass skipped (JOURNAL_S3_BUCKET not configured — L1-only tier)')

    return checkedSegments
  }
  const s3 = new S3Client({ region: config.journal.s3Region })
  const kms = config.journal.kmsSigningKeyId
    ? new KMSClient({ region: config.journal.s3Region })
    : null
  const journal = db().collection<JournalDoc>(JOURNAL_COLLECTION)

  const keys: string[] = []
  let token: string | undefined

  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'segments/', ContinuationToken: token }),
    )

    for (const object of page.Contents ?? []) {
      if (object.Key?.endsWith('.manifest.json')) keys.push(object.Key)
    }
    token = page.NextContinuationToken
  } while (token)
  keys.sort()

  const state = await db()
    .collection<SealStateDoc>(SEAL_STATE_COLLECTION)
    .findOne({ _id: '__global__' })

  let prevHash: string = GENESIS_SEGMENT_HASH
  const seenManifestHashes = new Set<string>()
  const latestInventoryHeads = new Map<string, { maxSeq: number; headHash: string }>()

  for (const key of keys) {
    checkedSegments += 1
    const manifestRaw = await (
      await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    ).Body!.transformToString()
    const signed = JSON.parse(manifestRaw) as SignedSegmentManifest
    const bodyKey = key.replace('.manifest.json', '.jsonl')
    const body = await (
      await s3.send(new GetObjectCommand({ Bucket: bucket, Key: bodyKey }))
    ).Body!.transformToString()

    for (const violation of verifySegment({ signed, body, expectedPrevSegmentHash: prevHash })) {
      report(
        'HARD',
        `segment ${signed.manifest.segmentId}`,
        `${violation.code}: ${violation.message}`,
      )
    }
    // WORM must stay hash-only: display copies (contentHot) are deletable by
    // design and must never be sealed. Structural check, not a substring match
    // — commands/messages that merely MENTION "contentHot" (like the PR that
    // built this) must not trip a HARD verdict.
    if (signed.manifest.kind === 'events') {
      for (const line of body.split('\n').filter(Boolean)) {
        let parsed: Record<string, unknown>

        try {
          parsed = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue // verifySegment already reports body_line_unparseable
        }
        if (Object.hasOwn(parsed, 'contentHot')) {
          report(
            'HARD',
            `segment ${signed.manifest.segmentId}`,
            'sealed event carries a contentHot field — un-deletable storage must hold hashes only',
          )
          break
        }
      }
    }
    prevHash = signed.manifestHash
    seenManifestHashes.add(signed.manifestHash)

    if (signed.signature && kms) {
      const verified = await kms.send(
        new VerifyCommand({
          KeyId: signed.signature.keyId,
          Message: Buffer.from(signed.manifestHash, 'hex'),
          MessageType: 'DIGEST',
          SigningAlgorithm: signed.signature.alg as 'ECDSA_SHA_256',
          Signature: Buffer.from(signed.signature.signatureBase64, 'base64'),
        }),
      )

      if (!verified.SignatureValid) {
        report('HARD', `segment ${signed.manifest.segmentId}`, 'KMS signature is INVALID')
      }
    } else if (!signed.signature && config.journal.kmsSigningKeyId) {
      report(
        'SOFT',
        `segment ${signed.manifest.segmentId}`,
        'segment is unsigned (sealed before signing was enabled?)',
      )
    }

    if (signed.manifest.kind === 'events') {
      // Sealed history is the trust anchor: the hot copy must still agree.
      for (const range of signed.manifest.coverage) {
        const docs = await journal
          .find({ sessionId: range.sessionId, seq: { $gte: range.fromSeq, $lte: range.toSeq } })
          .sort({ seq: 1 })
          .toArray()

        if (docs.length !== range.toSeq - range.fromSeq + 1) {
          report(
            'HARD',
            `segment ${signed.manifest.segmentId}`,
            `sealed range ${range.sessionId}[${range.fromSeq},${range.toSeq}] is incomplete in Mongo (${docs.length} rows) — sealed events were deleted from the hot copy`,
          )
        }
      }
      const sealedHashes = new Set(signed.manifest.eventHashes)

      for (const range of signed.manifest.coverage) {
        const docs = await journal
          .find({ sessionId: range.sessionId, seq: { $gte: range.fromSeq, $lte: range.toSeq } })
          .toArray()

        for (const doc of docs) {
          if (!sealedHashes.has(doc.entryHash)) {
            report(
              'HARD',
              `segment ${signed.manifest.segmentId}`,
              `${range.sessionId} seq ${doc.seq}: hot copy entryHash differs from the sealed segment — sealed history was rewritten in Mongo`,
            )
          }
        }
      }
    } else {
      latestInventoryHeads.clear()
      for (const line of body.split('\n').filter(Boolean)) {
        const head = JSON.parse(line) as { sessionId: string; maxSeq: number; headHash: string }

        latestInventoryHeads.set(head.sessionId, { maxSeq: head.maxSeq, headHash: head.headHash })
      }
    }
  }

  // Deletion detection (v2 #4): every conversation in the latest inventory
  // must still exist with at least that many events, or carry a tombstone.
  if (latestInventoryHeads.size > 0) {
    for (const [sessionId, head] of latestInventoryHeads) {
      const tail = await journal.find({ sessionId }).sort({ seq: -1 }).limit(1).toArray()
      const maxSeq = tail[0]?.seq ?? 0

      if (maxSeq >= head.maxSeq) continue
      const tombstoned = await journal.findOne({
        sessionId,
        type: { $in: ['conversation_retention_tombstone', 'journal_retention_expired'] },
      })

      if (!tombstoned) {
        report(
          'HARD',
          `conversation ${sessionId}`,
          `inventory recorded ${head.maxSeq} events, hot copy now has ${maxSeq} and no retention tombstone — events (or the whole conversation) were deleted`,
        )
      }
    }
  }

  // Head reconciliation: truncating the NEWEST segment(s) from S3 leaves the
  // remaining chain internally consistent, so the head must be checked against
  // independent references. lastAnchoredSegmentHash is the stronger one — the
  // external anchors vouch for it; lastSegmentHash lives in Mongo and could be
  // tampered alongside, but a mismatch still forces an explanation.
  if (state?.lastAnchoredSegmentHash && !seenManifestHashes.has(state.lastAnchoredSegmentHash)) {
    report(
      'HARD',
      'segments',
      `externally anchored segment head ${state.lastAnchoredSegmentHash.slice(0, 12)}… is missing from S3 — anchored sealed history was truncated`,
    )
  }
  if (
    state?.lastSegmentHash &&
    state.lastSegmentHash !== GENESIS_SEGMENT_HASH &&
    !state.pending &&
    state.lastSegmentHash !== prevHash
  ) {
    report(
      'HARD',
      'segments',
      `seal-state chain head ${state.lastSegmentHash.slice(0, 12)}… does not match the S3 chain head ${prevHash.slice(0, 12)}… — newest segment(s) truncated from S3, or seal state tampered`,
    )
  }
  if (state?.pending) {
    report(
      'SOFT',
      'sealer',
      `pending segment ${state.pending.segmentId} awaiting recovery (crash mid-seal?)`,
    )
  }

  return checkedSegments
}
