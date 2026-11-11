import { BSON } from 'mongodb'

import { redactSignedTokens } from '@/lib/claude-code-preview/mcp-token'
import { findSecrets, redactTokenShapes } from '@/lib/secrets/scan'

import { preserveRuntimeToolResults, runtimeToolResults } from './transcript-runtime-tool-results'
import { withoutToolOutputs } from './transcript-tool-output'

import type { AgentMessage } from './shared'
import type { ConversationTranscriptSync } from './transcript-types'
import type { MessageMetadata } from '@/lib/agent/message-metadata'

/** Every field a message write sets, read back to compare against it. */
export const STORED_MESSAGE_FIELDS = {
  _id: 1,
  index: 1,
  messageId: 1,
  role: 1,
  parts: 1,
  metadata: 1,
  origin: 1,
  turnOrigin: 1,
  turnKind: 1,
}

// The driver writes an undefined field as null (ignoreUndefined: false).
const AS_STORED = { ignoreUndefined: false }

/** Every field the write would set already holds that value, as BSON stores it. */
function alreadyStored(stored: AgentMessage | undefined, fields: Record<string, unknown>): boolean {
  if (!stored) return false
  const current = stored as unknown as Record<string, unknown>

  return Object.entries(fields).every(([key, value]) =>
    Buffer.from(BSON.serialize({ value }, AS_STORED)).equals(
      BSON.serialize({ value: current[key] }, AS_STORED),
    ),
  )
}

// Agent output arrives in chunks that can split a token, so redact once the
// message is assembled. Token characters are never JSON-escaped. Well-known
// key shapes are a safety net for a secret an agent printed by mistake.
async function redacted(parts: unknown[]): Promise<unknown[]> {
  const json = JSON.stringify(parts)
  const clean = redactSignedTokens(json)

  if (clean === json && (await findSecrets(json, 'tokenShapes')).length === 0) {
    return parts
  }

  // Per string, so a match can never span two JSON values.
  return (await mapStrings(JSON.parse(clean), redactTokenShapes)) as unknown[]
}

async function mapStrings(
  value: unknown,
  map: (text: string) => Promise<string>,
): Promise<unknown> {
  if (typeof value === 'string') return map(value)
  if (Array.isArray(value)) return Promise.all(value.map((item) => mapStrings(item, map)))
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(async ([key, item]) => [
      key,
      await mapStrings(item, map),
    ])

    return Object.fromEntries(await Promise.all(entries))
  }

  return value
}

/**
 * Upserts for the transcript, skipping messages already stored as they would
 * be written. A long conversation used to rewrite every message on every send.
 */
export async function messageWrites(
  data: ConversationTranscriptSync,
  stored: {
    attribution: Map<
      string,
      { metadata: MessageMetadata; role: 'user' | 'assistant'; parts: unknown[] }
    >
    runtimeToolParts: unknown[]
    /** Stored docs already at their incoming index. */
    storedAt: Map<number, AgentMessage>
    now: Date
    /** Index of the first message in `data.messages`. */
    offset?: number
  },
) {
  const { attribution, runtimeToolParts, storedAt, now, offset = 0 } = stored
  // Once per sync: rebuilt per message, this scanned every stored part for
  // every message and stalled the event loop for seconds on long conversations.
  const results = runtimeToolResults(runtimeToolParts)

  const writes = []

  for (const [position, message] of data.messages.entries()) {
    const index = offset + position
    const fields = {
      ...(attribution.get(message.id) || message.metadata
        ? { metadata: attribution.get(message.id)?.metadata ?? message.metadata }
        : {}),
      messageId: message.id,
      role: attribution.get(message.id)?.role ?? message.role,
      parts: await redacted(
        withoutToolOutputs(
          preserveRuntimeToolResults(
            attribution.get(message.id)?.role === 'user'
              ? attribution.get(message.id)!.parts
              : message.parts,
            results,
          ),
        ),
      ),
      // Only ever set, never unset: a re-sync that rebuilt history
      // without the bridge context must not erase where the message
      // originally came from.
      ...(message.origin ? { origin: message.origin } : {}),
      ...(message.turnOrigin === 'autonomous' ? { turnOrigin: 'autonomous' as const } : {}),
      ...(message.turnKind === 'plan-approval' ? { turnKind: 'plan-approval' as const } : {}),
    }

    if (alreadyStored(storedAt.get(index), fields)) continue
    writes.push({
      updateOne: {
        filter: { sessionId: data.sessionId, userId: data.userId, index },
        update: {
          $set: { ...fields, updatedAt: now },
          $setOnInsert: { sessionId: data.sessionId, userId: data.userId, index, createdAt: now },
        },
        upsert: true,
      },
    })
  }

  return writes
}
