import type { ConversationAccessState, GeneralAccess, ParticipantRole } from './agent-types.ts'

/** Who may open a session and what they may do there. */
export type WindowSessionAccessApi = {
  agentGetConversationParticipants(
    sessionId: string,
    teamId?: string,
  ): Promise<ConversationAccessState>
  agentInviteConversationParticipants(
    sessionId: string,
    teamId: string,
    userIds: string[],
    role: ParticipantRole,
  ): Promise<ConversationAccessState>
  agentRemoveConversationParticipant(
    sessionId: string,
    teamId: string,
    userId: string,
  ): Promise<ConversationAccessState>
  agentSetConversationParticipantRole(
    sessionId: string,
    teamId: string,
    userId: string,
    role: ParticipantRole,
  ): Promise<ConversationAccessState>
  agentSetConversationGeneralAccess(
    sessionId: string,
    teamId: string,
    generalAccess: GeneralAccess,
  ): Promise<ConversationAccessState>
}
