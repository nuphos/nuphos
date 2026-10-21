import { BSON } from 'mongodb'

import { redactSignedTokens } from '@/lib/claude-code-preview/mcp-token'

import { preserveRuntimeToolResults } from './transcript-runtime-tool-results'
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
// message is assembled. Token characters are never JSON-escaped.
function redacted(parts: unknown[]): unknown[] {
  const json = JSON.stringify(parts)
  const clean = redactSignedTokens(json)

  return clean === json ? parts : (JSON.parse(clean) as unknown[])
}

/**
 * Upserts for the transcript, skipping messages already stored as they would
 * be written. A long conversation used to rewrite every message on every send.
 */
export function messageWrites(
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
  },
) {
  const { attribution, runtimeToolParts, storedAt, now } = stored

  return data.messages.flatMap((message, index) => {
    const fields = {
      ...(attribution.get(message.id) || message.metadata
        ? { metadata: attribution.get(message.id)?.metadata ?? message.metadata }
        : {}),
      messageId: message.id,
      role: attribution.get(message.id)?.role ?? message.role,
      parts: redacted(
        withoutToolOutputs(
          preserveRuntimeToolResults(
            attribution.get(message.id)?.role === 'user'
              ? attribution.get(message.id)!.parts
              : message.parts,
            runtimeToolParts,
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

    if (alreadyStored(storedAt.get(index), fields)) return []

    return [
      {
        updateOne: {
          filter: { sessionId: data.sessionId, userId: data.userId, index },
          update: {
            $set: { ...fields, updatedAt: now },
            $setOnInsert: { sessionId: data.sessionId, userId: data.userId, index, createdAt: now },
          },
          upsert: true,
        },
      },
    ]
  })
}
