import type { AgentChatBody } from './types'
import type { AgentConversation } from '@/lib/agent/db'
import type { UIMessage } from 'ai'

import { getConversationMessagesHead } from '@/lib/agent/db'
import { attributeAppMessages } from '@/lib/agent/message-attribution'
import {
  validateRequestedAgentRuntime,
  validateRequestedRuntimeId,
} from '@/lib/claude-code-preview/runtime-routing'
import { AppError } from '@/lib/errors'

export function validateChatBody(body: AgentChatBody): void {
  validateRequestedAgentRuntime(body.agentRuntime)
  validateRequestedRuntimeId(body.runtimeId)
  const baseIndex = body.baseIndex ?? 0

  if (!Number.isInteger(baseIndex) || baseIndex < 0) {
    throw new AppError(400, 'invalid_request', 'baseIndex must be a non-negative integer')
  }
  if (
    body.continueAfterInterruption != null &&
    typeof body.continueAfterInterruption !== 'boolean'
  ) {
    throw new AppError(400, 'invalid_request', 'continueAfterInterruption must be a boolean')
  }
  if (
    body.resumeReason != null &&
    body.resumeReason !== 'permission-decision' &&
    body.resumeReason !== 'approval-decision' &&
    body.resumeReason !== 'client-tool'
  ) {
    throw new AppError(400, 'invalid_request', 'invalid resumeReason')
  }
}

/**
 * The stored prefix a suffix-window request stands on: the first `baseIndex`
 * stored messages in transcript order. `baseIndex` is a COUNT — the store is
 * read by sort+limit, never by index arithmetic, because racing persists can
 * leave holes in the stored index sequence, and a hole would make an
 * index-based read come up short on every retry, wedging the session.
 * Prefix entries whose id reappears in the incoming window are dropped (a
 * rebase after a partial sync must not duplicate a message). Throws 409 with
 * the stored count when the store holds fewer messages than the client
 * claims, so the client can rebase onto the server's count instead of
 * blindly resending everything.
 */
export async function hydrateStoredPrefix(
  sessionId: string,
  userId: string,
  baseIndex: number,
  incoming: { id: string }[],
): Promise<{ id: string; role: 'user' | 'assistant'; parts: unknown[] }[]> {
  const prefix = await getConversationMessagesHead(sessionId, userId, baseIndex)

  if (prefix.length < baseIndex) {
    throw new AppError(
      409,
      'transcript_out_of_sync',
      `Stored transcript has ${String(prefix.length)} messages; client claimed ${String(baseIndex)}`,
      { storedMessageCount: prefix.length },
    )
  }
  const incomingIds = new Set(incoming.map((message) => message.id))

  return prefix
    .filter((message) => !incomingIds.has(message.messageId))
    .map((message) => ({
      id: message.messageId,
      role: message.role,
      parts: message.parts,
      ...(message.metadata ? { metadata: message.metadata } : {}),
    }))
}

/**
 * The client holds only the transcript tail; hydrate the stored prefix so
 * everything downstream (model context, persist, journal) sees the full
 * transcript exactly as if the client had sent it.
 */
export async function hydrateTranscriptPrefix(
  body: AgentChatBody,
  sessionId: string,
  runOwnerUserId: string,
  conversationForResume: AgentConversation | null,
  actorId = runOwnerUserId,
  deviceId?: string,
): Promise<UIMessage[]> {
  const baseIndex = body.baseIndex ?? 0
  let messages = body.messages

  if (baseIndex > 0) {
    if (!conversationForResume) {
      throw new AppError(409, 'transcript_out_of_sync', 'Conversation not found for baseIndex')
    }
    const prefix = await hydrateStoredPrefix(sessionId, runOwnerUserId, baseIndex, messages)

    messages = [...(prefix as UIMessage[]), ...messages]
    body.messages = messages
  }

  await attributeAppMessages(
    messages,
    sessionId,
    runOwnerUserId,
    actorId,
    Boolean(body.resume || body.continueAfterInterruption),
    deviceId,
  )

  return messages
}
