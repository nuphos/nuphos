import type { AgentConversation } from '../../../api/agent-types.ts'

/** A 1:1 Bot chat lists only the Bot in faces; group chats have no single Bot home. */
export function summaryTriggerHome(sessionId: string, conversation?: AgentConversation): string {
  if (conversation?.kind !== 'channel') return sessionId
  const faces = conversation.faces

  return faces?.length === 1 && faces[0]?.agent ? faces[0].id : sessionId
}
