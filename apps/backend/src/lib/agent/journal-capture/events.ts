import { deriveEventId, redactSecrets, sha256Hex } from '@/lib/journal'
import { logError } from '@/lib/observability'

import {
  extractClientToolResults,
  FAIL_CLOSED_TOOLS,
  fingerprint,
  OUTPUT_PREVIEW_CHARS,
  stableSerialize,
} from './helpers'

import type { TranscriptMessageLike } from './helpers'
import type { ToolAuthorization } from './types'
import type { AuditEventType, JournalDoc, JsonValue } from '@/lib/journal'
import type { Collection } from 'mongodb'

type AppendIdParts = { toolCallId?: string; messageId?: string; qualifier?: string }

/** Internal surface AgentJournal hands to the capture helpers below. */
export type JournalContext = {
  actor: { userId: string; teamId: string | null }
  base: { conversationId: string; requestId: string }
  collection: () => Promise<Collection<JournalDoc>>
  append: (
    type: AuditEventType,
    payload: JsonValue,
    idParts: AppendIdParts,
    contentHot?: JsonValue,
  ) => Promise<unknown>
  appendOpen: (
    type: AuditEventType,
    payload: JsonValue,
    idParts?: AppendIdParts,
    contentHot?: JsonValue,
  ) => Promise<void>
  authorization: () => Promise<ToolAuthorization | null>
}

export async function captureTranscriptMessages(
  ctx: JournalContext,
  messages: TranscriptMessageLike[],
  role: 'user' | 'assistant',
): Promise<void> {
  const candidates = messages.filter((message) => message.role === role)

  if (candidates.length === 0) return
  try {
    const type: AuditEventType = role === 'user' ? 'user_message' : 'assistant_message'
    const idFor = (message: TranscriptMessageLike) =>
      deriveEventId(type, {
        conversationId: ctx.base.conversationId,
        messageId: message.id,
      })
    const ids = candidates.map(idFor)
    const collection = await ctx.collection()
    const existing = new Set(
      (
        await collection.find({ eventId: { $in: ids } }, { projection: { eventId: 1 } }).toArray()
      ).map((doc) => doc.eventId),
    )

    for (const message of candidates) {
      if (existing.has(idFor(message))) continue
      const serialized = stableSerialize(message.parts)

      await ctx.appendOpen(
        type,
        {
          role,
          partCount: message.parts.length,
          contentHash: sha256Hex(serialized.text),
          contentBytes: Buffer.byteLength(serialized.text, 'utf8'),
          hashAlg: serialized.alg,
        },
        { messageId: message.id },
        // Display copy of the exact value hashed above; stays out of the chain
        // and out of sealed segments.
        serialized.value,
      )
    }
  } catch (err) {
    logError('journal.transcript_capture_failed', err, {
      session_id: ctx.base.conversationId,
      role,
    })
  }
}

export async function captureClientToolResults(
  ctx: JournalContext,
  messages: TranscriptMessageLike[],
): Promise<void> {
  for (const result of extractClientToolResults(messages)) {
    const serialized = stableSerialize(result.output)

    await ctx.appendOpen(
      'client_tool_result',
      {
        toolName: result.toolName,
        trust: 'client-reported',
        outputHash: sha256Hex(serialized.text),
        outputBytes: Buffer.byteLength(serialized.text, 'utf8'),
        hashAlg: serialized.alg,
        // local_exec runs behind the desktop's per-command approval dialog (or
        // a standing allow rule the user created) — the human is the decider by
        // construction.
        ...(result.toolName === 'local_exec'
          ? { authorization: { kind: 'user-approved', basis: 'approval-gate' } }
          : {}),
      },
      { messageId: result.messageId, toolCallId: result.toolCallId },
    )
  }
}

export async function captureToolIntent(
  ctx: JournalContext,
  input: { toolName: string; toolCallId: string; input: unknown },
): Promise<void> {
  const serialized = stableSerialize(input.input)
  const redaction = redactSecrets(serialized.text)
  const authorization = await ctx.authorization()
  const payload: JsonValue = {
    toolName: input.toolName,
    inputRedacted: redaction.redacted,
    redactionCount: redaction.redactedCount,
    hashAlg: serialized.alg,
    ...(authorization ? { authorization } : {}),
    ...fingerprint(serialized.text),
  }

  if (FAIL_CLOSED_TOOLS.has(input.toolName)) {
    try {
      await ctx.append('tool_call_intent', payload, { toolCallId: input.toolCallId })
    } catch (err) {
      logError('journal.fail_closed_blocked_tool', err, {
        tool_name: input.toolName,
        session_id: ctx.base.conversationId,
        request_id: ctx.base.requestId,
        user_id: ctx.actor.userId,
      })
      throw new Error(
        `Audit journal write failed; refusing to execute "${input.toolName}" (fail-closed). ` +
          'Retry the tool call — if this persists the journal store is unavailable.',
        { cause: err },
      )
    }

    return
  }
  await ctx.appendOpen('tool_call_intent', payload, { toolCallId: input.toolCallId })
}

export async function captureToolResult(
  ctx: JournalContext,
  result: {
    toolName: string
    toolCallId: string
    success: boolean
    output: unknown
    durationMs: number
  },
): Promise<void> {
  const serialized = stableSerialize(result.output)
  // toWellFormed: the truncation itself can split a surrogate pair, and a
  // lone surrogate in the payload would break the chain hash on read.
  const preview = redactSecrets(
    serialized.text.slice(0, OUTPUT_PREVIEW_CHARS).toWellFormed(),
  ).redacted

  await ctx.appendOpen(
    'tool_call_result',
    {
      toolName: result.toolName,
      success: result.success,
      durationMs: result.durationMs,
      outputHash: sha256Hex(serialized.text),
      outputBytes: Buffer.byteLength(serialized.text, 'utf8'),
      outputPreview: preview,
      hashAlg: serialized.alg,
    },
    { toolCallId: result.toolCallId },
  )
}
