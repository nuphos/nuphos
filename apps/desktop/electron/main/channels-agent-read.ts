import * as agent from '../agent'

import type { GeneralAccess, ParticipantRole } from '../../src/api/agent-types'

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
    role: ParticipantRole,
  ) => agent.inviteConversationParticipants(sessionId, teamId, userIds, role),
  'agent:setConversationParticipantRole': (
    _e: unknown,
    sessionId: string,
    teamId: string,
    userId: string,
    role: ParticipantRole,
  ) => agent.setConversationParticipantRole(sessionId, teamId, userId, role),
  'agent:setConversationGeneralAccess': (
    _e: unknown,
    sessionId: string,
    teamId: string,
    generalAccess: GeneralAccess,
  ) => agent.setConversationGeneralAccess(sessionId, teamId, generalAccess),
  'agent:removeConversationParticipant': (
    _e: unknown,
    sessionId: string,
    teamId: string,
    userId: string,
  ) => agent.removeConversationParticipant(sessionId, teamId, userId),
}
