import { getConversationPreviewAttachment } from '@/lib/agent/db'

import { registry, sessionsByConversation, sessionCreations } from './agent-chat-registry'
import { attachOpenAbSession } from './openab-session-attach'
import { observeSession } from './session-reattach'
import { runtimeRoute } from './team-openab-runtime'

import type { AcpHttpMcpServer } from './openab-acp-client'
import type { OpenAbSessionRuntime } from './openab-acp-session'
import type { RuntimeDefaults } from './openab-acp-session'
import type { TeamRuntimeEndpoint, TeamSession } from './team-openab-runtime'

export async function openConversationSession(
  teamId: string,
  conversationId: string,
  userId: string,
  locale: string,
  endpoint: TeamRuntimeEndpoint,
  mcpServers: AcpHttpMcpServer[],
  systemPrompt: string | undefined,
  runtime: OpenAbSessionRuntime | undefined,
  onFreshSession?: () => void,
  conversationOwnerUserId = userId,
): Promise<TeamSession> {
  const key = `${teamId}:${conversationId}`
  const route = runtimeRoute(endpoint)
  // Opening again sees what the other opening left: a session on another route is replaced.
  const again = () =>
    openConversationSession(
      teamId,
      conversationId,
      userId,
      locale,
      endpoint,
      mcpServers,
      systemPrompt,
      runtime,
      onFreshSession,
      conversationOwnerUserId,
    )
  const pending = sessionCreations.get(key)

  if (pending) {
    if (pending.route === route) return pending.session
    await pending.session.catch(() => {})

    return again()
  }
  const existing = sessionsByConversation.get(key)

  if (existing) {
    const attachment = await getConversationPreviewAttachment(conversationId, teamId)

    if (
      runtimeRoute(existing.endpoint) === route &&
      existing.openabSessionId === attachment?.openabSessionId
    )
      return existing
    existing.stopObserving?.()
    sessionsByConversation.delete(key)
  }
  // Another opening began while this one looked.
  if (sessionCreations.has(key)) return again()
  const creation = (async () => {
    const client = await registry.acquire(teamId, endpoint)
    let session: TeamSession | undefined
    const observe = (openabSessionId: string, defaults: RuntimeDefaults) => {
      session = {
        teamId,
        conversationId,
        userId,
        conversationOwnerUserId,
        locale,
        openabSessionId,
        client,
        endpoint,
        mcpServers,
        ...(systemPrompt ? { systemPrompt } : {}),
        runtime: { ...runtime, defaults },
        contextDeliveredAt: Date.now(),
      }
      observeSession(session)
      sessionsByConversation.set(key, session)
    }

    try {
      const { openabSessionId, fresh, defaults } = await attachOpenAbSession(
        client,
        teamId,
        conversationId,
        endpoint,
        mcpServers,
        systemPrompt,
        runtime,
        observe,
      )

      if (fresh) onFreshSession?.()
      if (!session) observe(openabSessionId, defaults)
    } catch (error) {
      session?.stopObserving?.()
      if (sessionsByConversation.get(key) === session) sessionsByConversation.delete(key)
      throw error
    }

    return session!
  })().finally(() => sessionCreations.delete(key))

  sessionCreations.set(key, { route, session: creation })

  return creation
}
