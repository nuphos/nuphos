import type { AgentChatBody } from './types'
import type { AgentConversation } from '@/lib/agent/db'

export function shouldInitializePermissionMode(
  body: Pick<AgentChatBody, 'resume' | 'permissionMode' | 'messages' | 'baseIndex'>,
  conversation: Pick<AgentConversation, 'messageCount'> | null,
): boolean {
  return (
    !body.resume &&
    (body.permissionMode === 'auto' || body.permissionMode === 'bypass') &&
    !body.baseIndex &&
    body.messages.length === 1 &&
    body.messages[0]?.role === 'user' &&
    (!conversation || conversation.messageCount <= 1)
  )
}
