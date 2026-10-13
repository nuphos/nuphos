import { agentConversations, agentMessages, withTeamScope } from './shared'
import { syncConversationTranscriptUnlocked } from './transcript'
import { withTranscriptWriteLock } from './transcript-write-lock'

import type { ConversationTranscriptSync } from './transcript'

/** A runtime-owned turn, appended outside any interactive turn. */
export function appendAutonomousConversationTurn(data: {
  sessionId: string
  userId: string
  teamId: string
  message: { id: string; parts: unknown[] }
  locale?: string
  provider?: string
}): Promise<boolean> {
  const { message, ...rest } = data

  return appendConversationMessages({
    ...rest,
    messages: [{ ...message, role: 'assistant', turnOrigin: 'autonomous' }],
  })
}

/**
 * Append messages against the latest durable transcript while holding the
 * same lock as ordinary full-transcript writes. The read must be inside that
 * critical section: reading first and then calling the public sync function
 * recreates the stale-snapshot race this helper exists to stop. Messages
 * already stored under the same id are left alone.
 */
export async function appendConversationMessages(data: {
  sessionId: string
  userId: string
  teamId: string
  messages: ConversationTranscriptSync['messages']
  locale?: string
  provider?: string
}): Promise<boolean> {
  return await withTranscriptWriteLock(data.sessionId, data.userId, async () => {
    const conversation = await agentConversations().findOne(
      withTeamScope({ sessionId: data.sessionId, userId: data.userId }, data.teamId),
    )

    if (!conversation) return false
    const stored = await agentMessages()
      .find({ sessionId: data.sessionId, userId: data.userId })
      .sort({ index: 1 })
      .toArray()
    const messages: ConversationTranscriptSync['messages'] = stored.map((message) => ({
      id: message.messageId,
      role: message.role,
      parts: message.parts,
      ...(message.origin ? { origin: message.origin } : {}),
      ...(message.turnOrigin === 'autonomous' ? { turnOrigin: 'autonomous' as const } : {}),
      ...(message.turnKind === 'plan-approval' ? { turnKind: 'plan-approval' as const } : {}),
    }))

    const fresh = data.messages.filter((message) => stored.every((s) => s.messageId !== message.id))

    if (fresh.length === 0) return true
    messages.push(...fresh)
    await syncConversationTranscriptUnlocked({
      sessionId: data.sessionId,
      userId: data.userId,
      teamId: data.teamId,
      title: '',
      firstMessage: conversation.firstMessage || 'New chat',
      messages,
      locale: conversation.metadata?.locale ?? data.locale,
      provider: conversation.metadata?.provider ?? data.provider,
      preserveTitle: true,
    })

    return true
  })
}
