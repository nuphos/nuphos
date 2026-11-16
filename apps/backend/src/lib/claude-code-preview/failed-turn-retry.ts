import { randomUUID } from 'node:crypto'

import { startConversationTurn } from '@/lib/agent/conversation-turn'
import { getConversationBySessionId, getConversationMessages } from '@/lib/agent/db'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import { logError } from '@/lib/observability'

import type { AgentMessage } from '@/lib/agent/db'
import type { MessageMetadata } from '@/lib/agent/message-metadata'

export type FailedPrompt = { text: string; metadata: MessageMetadata }

const typeOf = (part: unknown) => (part as { type?: unknown } | null)?.type

/**
 * The prompt behind the last turn when its runtime (usage, sign-in, offline)
 * stopped it before it did anything: no text, reasoning or tool call, so
 * running it again elsewhere repeats nothing. A resend runs as the owner, so a
 * teammate's prompt is left for them; one with a file is more than its text.
 */
export function failedPrompt(
  messages: Pick<AgentMessage, 'role' | 'parts' | 'metadata'>[],
  ownerId: string,
): FailedPrompt | null {
  const [asked, reply] = messages.slice(-2)

  if (asked?.role !== 'user' || reply?.role !== 'assistant') return null
  const parts = reply.parts.filter((part) => typeOf(part) !== 'step-start')
  // `cause` is only set when the runtime itself was the reason.
  const [only] = parts as { type?: unknown; cause?: unknown }[]

  if (parts.length !== 1 || only?.type !== 'turn-interrupted' || !only.cause) return null
  const metadata = parseMessageMetadata(asked.metadata)

  if (!metadata || (metadata.sender.type === 'user' && metadata.sender.id !== ownerId)) return null
  if (!asked.parts.every((part) => typeOf(part) === 'text')) return null
  const text = (asked.parts as { text: string }[]).map((part) => part.text).join('')

  return text ? { text, metadata } : null
}

export async function lastFailedPrompt(sessionId: string, ownerId: string) {
  return failedPrompt(await getConversationMessages(sessionId, ownerId, { tail: 2 }), ownerId)
}

/** Sends the failed prompt once more, as its sender, on the runtime the conversation moved to. */
export function resendFailedPrompt(sessionId: string, prompt: FailedPrompt): void {
  void (async () => {
    const moved = await getConversationBySessionId(sessionId)

    if (!moved?.teamId) return
    const { run } = await startConversationTurn(
      {
        userId: moved.userId,
        teamId: moved.teamId,
        targetSessionId: sessionId,
        messageId: randomUUID(),
        locale: moved.metadata?.locale ?? 'en-US',
      },
      moved,
      prompt.text,
      prompt.metadata.source === 'agent.resource' ? 'agent.resource' : 'agent.thread',
      { ...prompt.metadata, sentAt: new Date().toISOString() },
    )

    await run
  })().catch((error: unknown) => {
    logError('agent.runtime_move.retry_failed', error, { session_id: sessionId })
  })
}
