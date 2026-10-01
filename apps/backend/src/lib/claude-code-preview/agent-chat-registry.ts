import { reachableRuntimeEndpoint } from './dev-runtime-forward'
import { OpenAbAcpClient } from './openab-acp-client'
import { createTeamRuntimeRegistry } from './team-openab-runtime'

import type { TeamPreviewClient, TeamSession } from './team-openab-runtime'

export const sessionsByConversation = new Map<string, TeamSession>()
export const sessionCreations = new Map<string, { teamId: string; promise: Promise<TeamSession> }>()
/** Separate sockets keep operator capabilities out of prompt transports. */
export const controlRegistry = createTeamRuntimeRegistry(async (endpoint) =>
  OpenAbAcpClient.connect(await reachableRuntimeEndpoint(endpoint)),
)
export const registry = createTeamRuntimeRegistry<TeamPreviewClient>(async (endpoint) =>
  OpenAbAcpClient.connect(await reachableRuntimeEndpoint(endpoint)),
)

/** Process-local observability for the runtime-status probe (runtime-status.ts). */
export function previewRuntimeObservability(
  teamId: string,
  provider: 'claude-code' | 'codex' = 'claude-code',
  runtimeUrls?: string[],
): {
  connectedAtMs?: number
  /** Build identity the runtime reported on initialize (version handshake). */
  buildSha?: string
  adapterVersion?: string
  attachedConversations: number
} {
  // eslint-disable-next-line sonarjs/no-empty-collection -- agent-chat-runtime populates this shared registry
  const conversations = [...sessionsByConversation.values()].filter(
    (session) =>
      session.teamId === teamId &&
      (session.endpoint.provider ?? 'claude-code') === provider &&
      (!runtimeUrls || runtimeUrls.includes(session.endpoint.url)),
  )
  const info = registry.connectionInfo(
    teamId,
    conversations.map((session) => session.endpoint.url),
  )

  return {
    ...(info.connectedAtMs === undefined ? {} : { connectedAtMs: info.connectedAtMs }),
    ...(info.buildSha ? { buildSha: info.buildSha } : {}),
    ...(info.adapterVersion ? { adapterVersion: info.adapterVersion } : {}),
    attachedConversations: conversations.length,
  }
}

/**
 * Clears a wedged inner session after a turn resolved with the
 * "(no response)" sentinel while its last tool never reported output: that
 * signature means the agent is blocked behind an unanswered permission
 * request, and its next prompt would sit silent until the gateway's idle
 * timeout. session/cancel propagates through the gateway to the pool and
 * frees the agent immediately; on a healthy idle session it is a no-op.
 */
export function cancelPreviewConversationSession(teamId: string, conversationId: string): boolean {
  // eslint-disable-next-line sonarjs/no-empty-collection -- agent-chat-runtime populates this shared registry
  const session = sessionsByConversation.get(`${teamId}:${conversationId}`)

  if (!session) return false
  session.client.cancel(session.openabSessionId)

  return true
}
