import * as agent from '../agent'
import * as atlas from '../atlas'

import type { GeneralAccess, ParticipantRole } from '../../src/api/agent-types'

// Agent reads that no longer fit in channels-agent.ts or channels-team.ts (max-lines).
export const agentReadChannels = {
  'atlas:getAgentStats': (_e: unknown, teamId: string, query: atlas.AgentStatsQuery) =>
    atlas.getAgentStats(teamId, query),
  'agent:getSessionResources': (_e: unknown, sessionId: string, teamId: string) =>
    agent.getSessionResources(sessionId, teamId),
  'agent:unlinkSessionResource': (
    _e: unknown,
    sessionId: string,
    teamId: string,
    resourceId: string,
  ) => agent.unlinkSessionResource(sessionId, teamId, resourceId),
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
  'agent:setConversationAvatar': (
    _e: unknown,
    sessionId: string,
    avatar: string | null,
    teamId?: string,
  ) => agent.setConversationAvatar(sessionId, avatar, teamId),
}
