import { config } from '@/config'
import { db } from '@/lib/db'
import {
  JOURNAL_COLLECTION,
  canonicalize,
  ensureJournalIndexes,
  hmacSha256Hex,
  toStorableJson,
} from '@/lib/journal'

import type { JournalDoc, JsonValue } from '@/lib/journal'
import type { Collection } from 'mongodb'

/**
 * Tools whose journal write failure must block execution: everything that
 * mutates infrastructure or sends outward-facing messages. All remaining
 * server tools are read-only and journal fail-open (logged, never blocking).
 * Exported as the canonical "mutation" classification for audit queries — the
 * mutations-only listing filter uses the same set.
 */
export const MUTATING_TOOL_NAMES = [
  'bash',
  // The database statement itself remains sealed in the Plan action. The
  // journal records only the bounded tool input (connectionId + planId), but
  // that intent must land before the approved mutation reaches the gateway.
  'database_change_execute',
  'slack_reply',
  'slack_react',
  'slack_post',
  'sonarqube_scan_fixture',
  'trigger_group_create',
  'trigger_delete',
  'trigger_finalize_wiring',
] as const
export const FAIL_CLOSED_TOOLS = new Set<string>(MUTATING_TOOL_NAMES)

/** Client-side tools executed by the desktop app; the backend only ever sees their reported results. */
const CLIENT_TOOL_NAMES = new Set([
  'local_exec',
  'port_forward_start',
  'port_forward_stop',
  'port_forward_list',
  'upload_attachment',
])

export const OUTPUT_PREVIEW_CHARS = 400

let journalCollection: Collection<JournalDoc> | null = null
let indexesEnsured: Promise<void> | null = null

/**
 * The unique indexes ((sessionId, seq) and eventId) ARE the chain/idempotency
 * guarantees, so no write may proceed before they exist — callers await this.
 * A failed ensure resets so the next call retries instead of caching failure.
 */
export async function getJournalCollection(): Promise<Collection<JournalDoc>> {
  if (!journalCollection) {
    journalCollection = db().collection<JournalDoc>(JOURNAL_COLLECTION)
  }
  if (!indexesEnsured) {
    indexesEnsured = ensureJournalIndexes(journalCollection).catch((err: unknown) => {
      indexesEnsured = null
      throw err
    })
  }
  await indexesEnsured

  return journalCollection
}

/**
 * Canonical JSON for hashing; falls back to JSON.stringify for exotic values.
 * Values are BSON-normalized first so the hash covers exactly what the store
 * round-trips — callers persisting a display copy must store the returned
 * `value`, never the original.
 */
export function stableSerialize(value: unknown): {
  text: string
  alg: 'jcs' | 'json'
  value: JsonValue
} {
  const storable = toStorableJson(value)

  try {
    return { text: canonicalize(storable), alg: 'jcs', value: storable }
  } catch {
    try {
      return {
        text: JSON.stringify(storable) ?? scalarText(storable),
        alg: 'json',
        value: storable,
      }
    } catch {
      return { text: scalarText(storable), alg: 'json', value: storable }
    }
  }
}

// Reached only once both canonicalize and JSON.stringify have thrown, which
// for a JsonValue means a cycle. `String()` on a cyclic array throws rather
// than degrading, so the container case gets a fixed marker.
function scalarText(value: JsonValue): string {
  return typeof value === 'object' && value !== null ? '[unserializable]' : String(value)
}

export function fingerprint(original: string): Record<string, JsonValue> {
  const key = config.journal.hmacKey

  if (!key) return {}

  return {
    inputHmac: hmacSha256Hex(key, original),
    hmacKeyId: config.journal.hmacKeyId,
    hmacKeyVersion: config.journal.hmacKeyVersion,
  }
}

export type TranscriptMessageLike = { id: string; role: string; parts: unknown[] }

/** Compact, secret-free description of a credential grant. */
export function summarizeCredentialAccess(access: Record<string, unknown>): JsonValue {
  const summary: Record<string, JsonValue> = {}

  for (const [provider, value] of Object.entries(access)) {
    if (Array.isArray(value)) {
      summary[provider] = value.map((entry) =>
        typeof entry === 'object' && entry !== null
          ? ((entry as { id?: unknown; arn?: unknown; name?: unknown }).id ??
            (entry as { arn?: unknown }).arn ??
            (entry as { name?: unknown }).name ??
            'unknown')
          : entry,
      ) as JsonValue
    } else if (value !== undefined) {
      summary[provider] = (value ?? null) as JsonValue
    }
  }

  return summary
}

type ClientToolResultPart = {
  messageId: string
  toolName: string
  toolCallId: string
  state: string
  output: unknown
}

/** Pull client-executed tool results (desktop-reported) out of incoming UI messages. */
export function extractClientToolResults(
  messages: TranscriptMessageLike[],
): ClientToolResultPart[] {
  const results: ClientToolResultPart[] = []

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (typeof part !== 'object' || part === null) continue
      const candidate = part as {
        type?: unknown
        toolCallId?: unknown
        state?: unknown
        output?: unknown
      }

      if (typeof candidate.type !== 'string' || !candidate.type.startsWith('tool-')) continue
      const toolName = candidate.type.slice('tool-'.length)

      if (!CLIENT_TOOL_NAMES.has(toolName)) continue
      if (candidate.state !== 'output-available') continue
      if (typeof candidate.toolCallId !== 'string') continue
      results.push({
        messageId: message.id,
        toolName,
        toolCallId: candidate.toolCallId,
        state: candidate.state,
        output: candidate.output,
      })
    }
  }

  return results
}
