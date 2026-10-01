import { callJson, teamQuery } from './http'

export type ConversationReadState = { activitySeq: number; readSeq: number; unread: boolean }

export async function markConversationRead(
  sessionId: string,
  seq: number,
  teamId?: string,
): Promise<ConversationReadState> {
  return callJson<ConversationReadState>(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/read${teamQuery(teamId)}`,
    { seq },
  )
}
