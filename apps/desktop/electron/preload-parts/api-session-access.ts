import { ipcRenderer } from 'electron'

import type { GeneralAccess, ParticipantRole } from '../../src/api/agent-types'

export const sessionAccessApi = {
  agentGetConversationParticipants: (sessionId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:getConversationParticipants', sessionId, teamId),
  agentInviteConversationParticipants: (
    sessionId: string,
    teamId: string,
    userIds: string[],
    role: ParticipantRole,
  ) => ipcRenderer.invoke('agent:inviteConversationParticipants', sessionId, teamId, userIds, role),
  agentSetConversationParticipantRole: (
    sessionId: string,
    teamId: string,
    userId: string,
    role: ParticipantRole,
  ) => ipcRenderer.invoke('agent:setConversationParticipantRole', sessionId, teamId, userId, role),
  agentSetConversationGeneralAccess: (
    sessionId: string,
    teamId: string,
    generalAccess: GeneralAccess,
  ) => ipcRenderer.invoke('agent:setConversationGeneralAccess', sessionId, teamId, generalAccess),
  agentRemoveConversationParticipant: (sessionId: string, teamId: string, userId: string) =>
    ipcRenderer.invoke('agent:removeConversationParticipant', sessionId, teamId, userId),
}
