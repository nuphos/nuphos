import * as agent from '../agent'

// Conversation-level channels that no longer fit in channels-agent.ts (max-lines).
export const agentReadChannels = {
  'agent:markConversationRead': (_e: unknown, sessionId: string, seq: number, teamId?: string) =>
    agent.markConversationRead(sessionId, seq, teamId),
  'agent:getConversationParticipants': (_e: unknown, sessionId: string, teamId?: string) =>
    agent.getConversationParticipants(sessionId, teamId),
  'agent:inviteConversationParticipants': (
    _e: unknown,
    sessionId: string,
    teamId: string,
    userIds: string[],
  ) => agent.inviteConversationParticipants(sessionId, teamId, userIds),
  'agent:removeConversationParticipant': (
    _e: unknown,
    sessionId: string,
    teamId: string,
    userId: string,
  ) => agent.removeConversationParticipant(sessionId, teamId, userId),
}
