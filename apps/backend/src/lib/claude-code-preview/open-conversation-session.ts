import { getConversationPreviewAttachment } from '@/lib/agent/db'

import { registry, sessionsByConversation, sessionCreations } from './agent-chat-registry'
import { attachOpenAbSession } from './openab-session-attach'
import { observeSession } from './session-reattach'

import type { AcpHttpMcpServer } from './openab-acp-client'
import type { OpenAbSessionRuntime } from './openab-acp-session'
import type { RuntimeDefaults } from './runtime-defaults'
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
  const pending = sessionCreations.get(key)

  if (pending) return pending
  const existing = sessionsByConversation.get(key)

  if (existing) {
    const attachment = await getConversationPreviewAttachment(conversationId, teamId)

    if (
      existing.endpoint.url === endpoint.url &&
      existing.openabSessionId === attachment?.openabSessionId
    )
      return existing
    existing.stopObserving?.()
    sessionsByConversation.delete(key)
  }
  let creation = sessionCreations.get(key)

  if (!creation) {
    creation = (async () => {
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
    sessionCreations.set(key, creation)
  }

  return creation
}
