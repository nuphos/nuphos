import * as agent from '../agent'
import * as atlas from '../atlas'

import type { GeneralAccess } from '../../src/api/agent-types'

// Agent reads that no longer fit in channels-agent.ts or channels-team.ts (max-lines).
export const agentReadChannels = {
  'agent:answerDecision': (_e: unknown, ...args: Parameters<typeof agent.answerDecision>) =>
    agent.answerDecision(...args),
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
  'agent:recordFork': (_e: unknown, ...args: Parameters<typeof agent.recordFork>) =>
    agent.recordFork(...args),
  'agent:recordEditFork': (
    _e: unknown,
    sessionId: string,
    forkSessionId: string,
    teamId?: string,
  ) => agent.recordEditFork(sessionId, forkSessionId, teamId),
  'agent:markConversationRead': (_e: unknown, sessionId: string, seq: number, teamId?: string) =>
    agent.markConversationRead(sessionId, seq, teamId),
  'agent:checkConversationMove': (
    _e: unknown,
    sessionId: string,
    teamId: string,
    runtimeId: string,
  ) => agent.checkConversationMove(sessionId, teamId, runtimeId),
  'agent:getConversationParticipants': (_e: unknown, sessionId: string, teamId?: string) =>
    agent.getConversationParticipants(sessionId, teamId),
  'agent:inviteConversationParticipants': (
    _e: unknown,
    sessionId: string,
    teamId: string,
    userIds: string[],
    grantComputerUse: boolean,
  ) => agent.inviteConversationParticipants(sessionId, teamId, userIds, grantComputerUse),
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
