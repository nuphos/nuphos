// Daily external anchoring (threat tier T3). Rewriting the entire segment chain
// requires recomputing every manifest hash — anchoring the chain head OUTSIDE
// our AWS account makes that rewrite detectable:
//
//   1. RFC 3161 timestamp: the head hash is submitted to a public Time
//      Stamping Authority; the returned token cryptographically binds the
//      hash to a third-party clock. Stored back to WORM as anchors/<date>.tsr.
//   2. Public git commit: one line per day appended via the GitHub contents
//      API to a public repo — rewriting history there is outside our control
//      plane entirely. Enabled once JOURNAL_ANCHOR_GITHUB_* is configured.
//
// Either anchor alone already forces an attacker to compromise an external
// party; both together are what the "整个公司串通也改不了" claim rests on.

import { logError, logEvent } from '@/lib/observability'

import { sha256Hex } from './hashing'

import type { SealStateDoc } from './sealer'
import type { Collection } from 'mongodb'

export type AnchorDeps = {
  state: Collection<SealStateDoc>
  putObject: (key: string, body: string | Uint8Array) => Promise<void>
  /** POST a DER TimeStampReq, resolve the DER TimeStampResp. Null when no TSA configured. */
  requestTimestamp: ((request: Uint8Array) => Promise<Uint8Array>) | null
  /** Append one line to the public anchor log. Null when not configured. */
  appendGitAnchor: ((line: string) => Promise<void>) | null
  now: () => Date
}

export type AnchorResult = {
  anchored: boolean
  date: string
  headHash: string | null
  tsa: boolean
  git: boolean
}

/**
 * Minimal DER encoding of an RFC 3161 TimeStampReq for a sha256 digest:
 *   TimeStampReq ::= SEQUENCE { version 1, messageImprint SEQUENCE {
 *     AlgorithmIdentifier(sha256), OCTET STRING digest }, certReq TRUE }
 * Hand-rolled because the request is tiny and fixed-shape; the golden test
 * freezes the exact bytes.
 */
export function buildTimestampRequest(digestHex: string): Uint8Array {
  const digest = Buffer.from(digestHex, 'hex')

  if (digest.length !== 32) throw new Error('timestamp request expects a sha256 hex digest')

  // AlgorithmIdentifier: SEQUENCE { OID 2.16.840.1.101.3.4.2.1 (sha256), NULL }
  const algorithm = Buffer.from([
    0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00,
  ])
  const octetString = Buffer.concat([Buffer.from([0x04, 0x20]), digest])
  const messageImprint = Buffer.concat([
    Buffer.from([0x30, algorithm.length + octetString.length]),
    algorithm,
    octetString,
  ])
  const version = Buffer.from([0x02, 0x01, 0x01])
  const certReq = Buffer.from([0x01, 0x01, 0xff])
  const bodyLength = version.length + messageImprint.length + certReq.length

  return Buffer.concat([Buffer.from([0x30, bodyLength]), version, messageImprint, certReq])
}

export async function anchorOnce(deps: AnchorDeps): Promise<AnchorResult> {
  const state = await deps.state.findOne({ _id: '__global__' })
  const date = deps.now().toISOString().slice(0, 10)
  const headHash = state?.lastSegmentHash ?? null

  if (!headHash || (state?.segmentCounter ?? 0) === 0) {
    return { anchored: false, date, headHash: null, tsa: false, git: false }
  }

  const anchor = {
    v: 1,
    date,
    anchoredAt: deps.now().toISOString(),
    segmentCounter: state?.segmentCounter ?? 0,
    lastSegmentHash: headHash,
    // The digest actually anchored: binds the date to the head hash so one
    // token cannot be replayed for a different day.
    anchoredDigest: sha256Hex(`nuphos-journal|${date}|${headHash}`),
  }

  let tsa = false

  if (deps.requestTimestamp) {
    try {
      const token = await deps.requestTimestamp(buildTimestampRequest(anchor.anchoredDigest))

      await deps.putObject(`anchors/${date}.tsr`, token)
      tsa = true
    } catch (err) {
      logError('journal.anchor.tsa_failed', err, { date })
    }
  }

  let git = false

  if (deps.appendGitAnchor) {
    try {
      await deps.appendGitAnchor(
        `${date} ${anchor.lastSegmentHash} seg=${String(anchor.segmentCounter)} digest=${anchor.anchoredDigest}`,
      )
      git = true
    } catch (err) {
      logError('journal.anchor.git_failed', err, { date })
    }
  }

  const anchored = tsa || git

  await deps.putObject(`anchors/${date}.json`, JSON.stringify({ ...anchor, tsa, git }))
  if (anchored) {
    await deps.state.updateOne(
      { _id: '__global__' },
      { $set: { lastAnchorAt: anchor.anchoredAt, lastAnchoredSegmentHash: headHash } },
    )
  }
  logEvent('info', 'journal.anchor.written', { date, tsa_anchored: tsa, git_anchored: git })

  return { anchored, date, headHash, tsa, git }
}
