import type { AgentChatBody } from './types'
import type { QueuedChatTurn } from '@/lib/agent/pending-message-types'

/** The /chat body a queued message is admitted with, as its device sent it. */
export function queuedChatBody(
  sessionId: string,
  teamId: string,
  chat: QueuedChatTurn,
): AgentChatBody {
  return {
    id: sessionId,
    teamId,
    messages: [chat.message],
    streamId: chat.streamId,
    clientCapabilities: { localTools: chat.localTools, decisionReplies: chat.decisionReplies },
    ...(chat.decisionReplyTo ? { decisionReplyTo: chat.decisionReplyTo } : {}),
  }
}
