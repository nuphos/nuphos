import { appendQuery, call } from './http'

export const agentRuntimeMethods = {
  agentMoveConversationRuntime: (
    sessionId: string,
    teamId: string,
    runtimeId: string,
    mode: 'history' | 'workspace',
  ) =>
    call(
      'POST',
      appendQuery(`/agent/conversations/${encodeURIComponent(sessionId)}/runtime`, { teamId }),
      { runtimeId, mode },
    ),
  agentGetConversationParticipants: (sessionId: string, teamId?: string) =>
    call(
      'GET',
      appendQuery(`/agent/conversations/${encodeURIComponent(sessionId)}/participants`, { teamId }),
    ),
  agentInviteConversationParticipants: (sessionId: string, teamId: string, userIds: string[]) =>
    call(
      'POST',
      appendQuery(`/agent/conversations/${encodeURIComponent(sessionId)}/participants`, { teamId }),
      { userIds },
    ),
  agentRemoveConversationParticipant: (sessionId: string, teamId: string, userId: string) =>
    call(
      'DELETE',
      appendQuery(
        `/agent/conversations/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(userId)}`,
        { teamId },
      ),
    ),
  agentGetSessionConfig: (sessionId: string, teamId: string) =>
    call(
      'GET',
      appendQuery(`/agent/conversations/${encodeURIComponent(sessionId)}/model-config`, {
        teamId,
      }),
    ),
  agentSetSessionConfig: (
    sessionId: string,
    teamId: string,
    selection: { configId: string; value: string },
  ) =>
    call(
      'PATCH',
      appendQuery(`/agent/conversations/${encodeURIComponent(sessionId)}/model-config`, {
        teamId,
      }),
      selection,
    ),
}
