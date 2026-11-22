import type { AgentConversationParticipant, GeneralAccess } from './agent-types.ts'
import type { SessionResourcesResponse } from './session-resource-types'

export type ConversationAccessState = {
  generalAccess: GeneralAccess
  participants: AgentConversationParticipant[]
  /** After a removal: the chat's computer the removed person can still use. */
  computerStillShared?: { deviceId: string; label: string }
}

/** Who may open a session and what they may do there. */
export type WindowSessionAccessApi = {
  agentGetSessionResources(sessionId: string, teamId: string): Promise<SessionResourcesResponse>
  /** Writes a secret to a file on the session's runtime; only the path comes back. */
  agentSaveSecret(
    sessionId: string,
    name: string,
    value: string,
    teamId?: string,
  ): Promise<{ ok: boolean; path: string }>
  agentUnlinkSessionResource(
    sessionId: string,
    teamId: string,
    resourceId: string,
  ): Promise<{ ok: boolean }>
  agentGetConversationParticipants(
    sessionId: string,
    teamId?: string,
  ): Promise<ConversationAccessState>
  agentInviteConversationParticipants(
    sessionId: string,
    teamId: string,
    userIds: string[],
    grantComputerUse: boolean,
  ): Promise<ConversationAccessState>
  agentRemoveConversationParticipant(
    sessionId: string,
    teamId: string,
    userId: string,
  ): Promise<ConversationAccessState>
  agentSetConversationGeneralAccess(
    sessionId: string,
    teamId: string,
    generalAccess: GeneralAccess,
  ): Promise<ConversationAccessState>
  agentSetConversationAvatar(
    sessionId: string,
    avatar: string | null,
    teamId?: string,
    background?: string,
  ): Promise<{ avatar: string | null; background?: string }>
  agentUploadConversationAvatar(
    sessionId: string,
    image: Uint8Array,
    teamId?: string,
  ): Promise<{ avatar: string }>
  agentSetBotInstructions(
    sessionId: string,
    instructions: string,
    teamId?: string,
  ): Promise<{ instructions: string }>
}
