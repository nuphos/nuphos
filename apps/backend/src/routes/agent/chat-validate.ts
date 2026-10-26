import type { AgentChatBody } from './types'
import type { AgentConversation } from '@/lib/agent/db'
import type { CliTokenPrincipal } from '@/lib/identity/cli-tokens'
import type { UIMessage } from 'ai'

import { agentMessages, getConversationMessagesHead } from '@/lib/agent/db'
import { attributeAppMessages } from '@/lib/agent/message-attribution'
import {
  validateRequestedAgentRuntime,
  validateRequestedRuntimeId,
} from '@/lib/claude-code-preview/runtime-routing'
import { sessionConfigPickSchema } from '@/lib/claude-code-preview/session-config-options'
import { AppError } from '@/lib/errors'

export function validateChatBody(body: AgentChatBody): void {
  // `id` reaches Mongo filters as-is; anything but a string could be an operator.
  if (
    typeof body.id !== 'string' ||
    !body.id ||
    !Array.isArray(body.messages) ||
    (body.streamId !== undefined && typeof body.streamId !== 'string')
  ) {
    throw new AppError(400, 'invalid_request', 'Body must include { id, messages }')
  }
  validateRequestedAgentRuntime(body.agentRuntime)
  validateRequestedRuntimeId(body.runtimeId)
  if (body.initialSessionConfig !== undefined) {
    const pick = sessionConfigPickSchema.safeParse(body.initialSessionConfig)

    if (!pick.success)
      throw new AppError(
        400,
        'invalid_request',
        'initialSessionConfig holds only model, effort, fast',
      )
    body.initialSessionConfig = pick.data
  }
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

function transcriptOutOfSync(stored: number, claimed: number): AppError {
  return new AppError(
    409,
    'transcript_out_of_sync',
    `Stored transcript has ${String(stored)} messages; client claimed ${String(claimed)}`,
    { storedMessageCount: stored },
  )
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

  if (prefix.length < baseIndex) throw transcriptOutOfSync(prefix.length, baseIndex)
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
 * The client sends only the tail from its latest user message on, which holds
 * the whole current turn. The stored prefix is not read back: the turn plan
 * rebuilds the transcript from the store anyway, so reading it here as well
 * cost a full transcript read on every send. Only its count is checked, so a
 * client ahead of the store still gets 409 and rebases.
 */
export async function acceptClientTail(
  body: AgentChatBody,
  sessionId: string,
  runOwnerUserId: string,
  conversationForResume: AgentConversation | null,
  actorId = runOwnerUserId,
  deviceId?: string,
  cliToken?: CliTokenPrincipal,
): Promise<UIMessage[]> {
  const baseIndex = body.baseIndex ?? 0
  const messages = body.messages

  if (baseIndex > 0) {
    // Nothing stored yet (e.g. the first send failed before persisting): the
    // stored count is 0, so the client rebases its tail onto an empty prefix.
    if (!conversationForResume) throw transcriptOutOfSync(0, baseIndex)
    const stored = await agentMessages().countDocuments({ sessionId, userId: runOwnerUserId })

    if (stored < baseIndex) throw transcriptOutOfSync(stored, baseIndex)
  }

  await attributeAppMessages(
    messages,
    sessionId,
    runOwnerUserId,
    actorId,
    Boolean(body.resume || body.continueAfterInterruption),
    deviceId,
    cliToken,
  )

  return messages
}
