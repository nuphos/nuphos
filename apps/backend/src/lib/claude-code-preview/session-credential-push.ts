import { resolveConversationChatRuntime } from './conversation-chat-route'
import { reachableRuntimeEndpoint } from './dev-runtime-forward'
import { OpenAbAcpClient } from './openab-acp-client'
import { supportsCredentialRefresh } from './openab-acp-session'

import type { OpenAbProvider } from './runtime-provider'

type Env = Record<string, string> | undefined

/** The runtime session a turn runs on. */
export type CredentialPushTarget = {
  teamId: string
  conversationId: string
  /** Durable conversation owner: the runtime is resolved as theirs, as the state probe does. */
  userId: string
  provider: OpenAbProvider
  runtimeId?: string
  runtimeUrl: string
  openabSessionId: string
}

/**
 * Hands a running session fresh credentials. The runtime takes
 * `_openab/session/credentials` only from a runtime-control connection, so this
 * opens one rather than using the turn's transport connection, which it
 * refuses. Resolves `false` when the runtime cannot take credentials mid-turn.
 */
export async function pushSessionCredentials(
  target: CredentialPushTarget,
  expected: Env,
  next: Env,
): Promise<boolean> {
  const { endpoint } = await resolveConversationChatRuntime(
    target.teamId,
    {
      sessionId: target.conversationId,
      userId: target.userId,
      agentRuntime: target.provider,
      runtimeId: target.runtimeId,
      claudeCodePreview: { runtimeUrl: target.runtimeUrl, openabSessionId: target.openabSessionId },
    },
    { purpose: 'control' },
  )

  if (endpoint.url !== target.runtimeUrl) throw new Error('Conversation runtime changed')
  const client = await OpenAbAcpClient.connect({
    ...(await reachableRuntimeEndpoint(endpoint)),
    connectTimeoutMs: 10_000,
    callTimeoutMs: 15_000,
  })

  try {
    if (!supportsCredentialRefresh(await client.initialize())) return false
    await client.refreshCredentials(target.openabSessionId, expected, next)

    return true
  } finally {
    client.close()
  }
}
