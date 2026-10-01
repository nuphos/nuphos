import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { canonicalize } from './canonical'

import type { AuditEventHeader, JsonValue } from './types'

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function computePayloadHash(payload: JsonValue): string {
  return sha256Hex(canonicalize(payload))
}

/**
 * entryHash covers the full header (including eventId, seq, prevHash and
 * payloadHash), so recomputing the chain detects edits, reorders, deletions
 * and inserted events alike.
 */
export function computeEntryHash(header: AuditEventHeader): string {
  return sha256Hex(
    canonicalize({
      v: header.v,
      eventId: header.eventId,
      seq: header.seq,
      ts: header.ts,
      type: header.type,
      actor: { userId: header.actor.userId, teamId: header.actor.teamId },
      session: {
        conversationId: header.session.conversationId,
        requestId: header.session.requestId,
        streamId: header.session.streamId,
        toolCallId: header.session.toolCallId,
        modelId: header.session.modelId,
      },
      payloadHash: header.payloadHash,
      prevHash: header.prevHash,
    }),
  )
}

/**
 * Keyed fingerprint for redacted-away originals (e.g. full bash commands).
 * Plain sha256 is forbidden here: commands have small guessable structure, so
 * an unkeyed hash can be dictionary-reversed — the HMAC key (KMS-managed in
 * production) is what makes the fingerprint non-invertible. Callers must
 * persist hmacKeyId/hmacKeyVersion next to the digest (v2.2).
 */
export function hmacSha256Hex(key: string | Buffer, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex')
}

/** Constant-time hex digest comparison for original-text challenges (avoids timing oracles). */
export function digestEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')

  if (bufA.length !== bufB.length || bufA.length === 0) return false

  return timingSafeEqual(bufA, bufB)
}
