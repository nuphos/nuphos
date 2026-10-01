import { controlRegistry } from './agent-chat-registry'
import { resolveConversationChatRuntime } from './conversation-chat-route'

import { agentConversations } from '@/lib/agent/db/shared'

/** The runtime owns pending requests and decisions; this module only routes RPC. */
export async function runtimeRequestStore(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const conversation = await agentConversations().findOne({ sessionId })

  if (!conversation?.claudeCodePreview) {
    if (params.operation === 'list') return { waits: [] }
    if (params.operation === 'read') return { wait: null, decision: null }
    throw new Error('Runtime session is not attached')
  }
  if (!conversation.teamId) throw new Error('Runtime session is missing its workspace')
  const { endpoint } = await resolveConversationChatRuntime(conversation.teamId, conversation, {
    purpose: 'control',
  })

  if (!endpoint || endpoint.url !== conversation.claudeCodePreview.runtimeUrl)
    throw new Error('Runtime placement changed')
  const client = await controlRegistry.acquire(conversation.teamId, endpoint)

  return client.sessionRequests(conversation.claudeCodePreview.openabSessionId, params)
}
