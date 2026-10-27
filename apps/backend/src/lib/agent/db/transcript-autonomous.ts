import { agentConversations, withTeamScope } from './shared'
import { appendTranscriptMessages } from './transcript'

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

/** Appends messages to an existing conversation; false when it does not exist. */
export async function appendConversationMessages(data: {
  sessionId: string
  userId: string
  teamId: string
  messages: ConversationTranscriptSync['messages']
  locale?: string
  provider?: string
}): Promise<boolean> {
  const conversation = await agentConversations().findOne(
    withTeamScope({ sessionId: data.sessionId, userId: data.userId }, data.teamId),
  )

  if (!conversation) return false
  await appendTranscriptMessages({
    sessionId: data.sessionId,
    userId: data.userId,
    teamId: data.teamId,
    title: '',
    firstMessage: conversation.firstMessage || 'New chat',
    messages: data.messages,
    locale: conversation.metadata?.locale ?? data.locale,
    provider: conversation.metadata?.provider ?? data.provider,
    preserveTitle: true,
  })

  return true
}
