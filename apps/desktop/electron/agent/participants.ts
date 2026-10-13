import { callJson, teamQuery } from './http'

import type {
  ConversationAccessState,
  GeneralAccess,
  ParticipantRole,
} from '../../src/api/agent-types'

type ParticipantsResponse = ConversationAccessState

function participantsPath(sessionId: string, teamId?: string): string {
  return `/agent/conversations/${encodeURIComponent(sessionId)}/participants${teamQuery(teamId)}`
}

export function getConversationParticipants(
  sessionId: string,
  teamId?: string,
): Promise<ParticipantsResponse> {
  return callJson('GET', participantsPath(sessionId, teamId), undefined, 12_000)
}

export function inviteConversationParticipants(
  sessionId: string,
  teamId: string,
  userIds: string[],
  role: ParticipantRole,
): Promise<ParticipantsResponse> {
  return callJson('POST', participantsPath(sessionId, teamId), { userIds, role }, 12_000)
}

export function setConversationParticipantRole(
  sessionId: string,
  teamId: string,
  userId: string,
  role: ParticipantRole,
): Promise<ParticipantsResponse> {
  const path = `/agent/conversations/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(userId)}${teamQuery(teamId)}`

  return callJson('PATCH', path, { role }, 12_000)
}

export function setConversationGeneralAccess(
  sessionId: string,
  teamId: string,
  generalAccess: GeneralAccess,
): Promise<ParticipantsResponse> {
  const path = `/agent/conversations/${encodeURIComponent(sessionId)}/access${teamQuery(teamId)}`

  return callJson('PATCH', path, { generalAccess }, 12_000)
}

export function removeConversationParticipant(
  sessionId: string,
  teamId: string,
  userId: string,
): Promise<ParticipantsResponse> {
  const path = `/agent/conversations/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(userId)}${teamQuery(teamId)}`

  return callJson('DELETE', path, undefined, 12_000)
}
