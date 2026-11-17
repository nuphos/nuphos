import { callJson, callJsonForRenderer, teamQuery } from './http'

import type { ConversationAccessState, GeneralAccess } from '../../src/api/agent-types'

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

/**
 * Someone who cannot use the session's computer is refused with
 * `computer_use_required` until the invite confirms giving them `use` of it,
 * so the error keeps its code for the renderer's confirmation. The answer is
 * always sent: a request without one comes from an older release, whose
 * invitees join reading only.
 */
export function inviteConversationParticipants(
  sessionId: string,
  teamId: string,
  userIds: string[],
  grantComputerUse: boolean,
): Promise<ParticipantsResponse> {
  return callJsonForRenderer(
    'POST',
    participantsPath(sessionId, teamId),
    { userIds, grantComputerUse },
    12_000,
  )
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

/** After removing someone: stop sharing the chat's computer with them too. */
export function stopConversationComputerUse(
  sessionId: string,
  teamId: string,
  userId: string,
): Promise<{ stopped: true; computer: { deviceId: string; label: string } }> {
  const path = `/agent/conversations/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(userId)}/stop-computer-use${teamQuery(teamId)}`

  return callJson('POST', path, undefined, 12_000)
}
