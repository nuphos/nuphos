import { resolveConversationChatRuntime } from './conversation-chat-route'
import { abandonPendingPreviewWaits } from './decision-waiter'
import { reachableRuntimeEndpoint } from './dev-runtime-forward'
import { OpenAbAcpClient } from './openab-acp-client'
import { OpenAbRpcError } from './openab-acp-errors'
import { materializeRuntimeAttachments, runtimeAttachments } from './runtime-attachments'
import { parseSessionExecutionState } from './runtime-execution-snapshot'

import type { SessionExecutionState } from './runtime-execution-snapshot'
import { liveAttachment } from '@/lib/agent/db/shared'

import type { AgentConversation } from '@/lib/agent/db'

/** A read-only control connection: never resume, restore, prompt, or claim an output sink. */
export async function conversationExecutionState(
  conversation: Pick<
    AgentConversation,
    | 'teamId'
    | 'sessionId'
    | 'userId'
    | 'agentRuntime'
    | 'runtimeId'
    | 'claudeCodePreview'
    | 'runtimeMigration'
  >,
): Promise<SessionExecutionState> {
  const attachment = liveAttachment(conversation)

  if (!conversation.teamId) return { state: 'disconnected' }
  // A moved conversation has no attachment by design: the move clears it and the
  // next prompt creates the session. Probing for one anyway reported
  // 'disconnected', which the desktop reads as a broken conversation — the status
  // says "Connection lost" and a queued message parks on "waiting for the agent
  // to be ready" forever, because only a prompt can change that state. Say what
  // is actually true. A conversation that has never been moved keeps the probe:
  // one from before attachments were tracked may still have a live session.
  if (!attachment && conversation.runtimeMigration)
    return {
      state: 'dormant',
      schemaVersion: 2,
      label: 'Ready — your next message starts the agent',
      actions: { send: true, cancel: false, steer: false, reply: false },
    }
  let client: OpenAbAcpClient | undefined

  try {
    const { endpoint } = await resolveConversationChatRuntime(conversation.teamId, conversation, {
      purpose: 'control',
    })

    if (!endpoint || (attachment && endpoint.url !== attachment.runtimeUrl))
      return { state: 'disconnected' }
    client = await OpenAbAcpClient.connect({
      ...(await reachableRuntimeEndpoint(endpoint)),
      connectTimeoutMs: 3_000,
      callTimeoutMs: 3_000,
    })
    await client.initialize()

    return parseSessionExecutionState(
      await client.getSessionExecutionState(
        attachment?.openabSessionId ?? 'sess_00000000-0000-0000-0000-000000000000',
      ),
    )
  } catch (error) {
    return {
      state:
        error instanceof OpenAbRpcError && error.code === -32601 ? 'unsupported' : 'disconnected',
    }
  } finally {
    client?.close()
  }
}

/** Send control over a separate connection; never depend on a backend stream lease. */
export async function cancelConversationRuntime(conversation: AgentConversation): Promise<void> {
  const attachment = liveAttachment(conversation)

  if (!attachment || !conversation.teamId) throw new Error('Conversation has no runtime session')
  const { endpoint } = await resolveConversationChatRuntime(conversation.teamId, conversation, {
    purpose: 'control',
  })

  if (!endpoint || endpoint.url !== attachment.runtimeUrl)
    throw new Error('Conversation runtime changed')
  const client = await OpenAbAcpClient.connect({
    ...(await reachableRuntimeEndpoint(endpoint)),
    connectTimeoutMs: 3_000,
    callTimeoutMs: 3_000,
  })

  try {
    await client.initialize()
    client.cancel(attachment.openabSessionId, true)
    // Round-trip after the notification confirms delivery, not completion.
    await client.getSessionExecutionState(attachment.openabSessionId)
  } finally {
    client.close()
  }
  // A cancelled turn has no one left to answer its cards, so nothing may stay
  // parked on them.
  await abandonPendingPreviewWaits({
    userId: conversation.userId,
    sessionId: conversation.sessionId,
    reason: 'turn_cancelled',
  }).catch(() => undefined)
}

/** The receipt names attached files, so the transcript records what was sent. */
export function steeringText(typed: string, fileNames: string[]): string {
  return [typed, fileNames.length ? `[Attached: ${fileNames.join(', ')}]` : '']
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Deliver to the existing native turn. No queue, resume, or prompt fallback.
 * Returns the text the runtime received, which is also the steering receipt.
 */
export async function steerConversationRuntime(
  conversation: AgentConversation,
  steer: { text: string; groupId?: string; userId: string },
  messageId: string,
): Promise<string> {
  const attachment = liveAttachment(conversation)

  if (!attachment || !conversation.teamId) throw new Error('Conversation has no runtime session')
  const { endpoint } = await resolveConversationChatRuntime(conversation.teamId, conversation, {
    purpose: 'control',
  })

  if (!endpoint || endpoint.url !== attachment.runtimeUrl)
    throw new Error('Conversation runtime changed')
  // Same delivery as a normal turn: files land on the runtime as local paths.
  const files = steer.groupId
    ? await runtimeAttachments(
        [{ type: 'transfer-upload', groupId: steer.groupId }],
        { teamId: conversation.teamId, userId: steer.userId, sessionId: conversation.sessionId },
        [],
      )
    : []
  const attachments = await materializeRuntimeAttachments(conversation.teamId, endpoint, files)
  const text = steeringText(
    steer.text,
    files.map((file) => file.name),
  )
  const client = await OpenAbAcpClient.connect({
    ...(await reachableRuntimeEndpoint(endpoint)),
    connectTimeoutMs: 3_000,
    callTimeoutMs: 15_000,
  })

  try {
    await client.initialize()
    const result = await client.steerSession(
      attachment.openabSessionId,
      text,
      messageId,
      attachments,
    )

    if (result.outcome !== 'injected')
      throw new Error('The turn already ended. Your message was not sent; send it as a new turn.')

    return text
  } finally {
    client.close()
  }
}
