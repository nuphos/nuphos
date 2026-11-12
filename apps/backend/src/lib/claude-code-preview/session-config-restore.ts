import { previewSessionAccess } from './credentials-mcp'
import { sessionMeta } from './openab-acp-session'
import { runtimeProvider } from './runtime-provider'
import { storedPick } from './session-config-options'
import { workspaceDirectory } from './session-context'
import { RUNTIME_CWD } from './team-openab-runtime'

import type { AgentConversation } from '@/lib/agent/db'

/** Rebuild the same owner-scoped context used by a normal turn, without running one. */
export async function sessionConfigRestoreContext(
  conversation: AgentConversation,
  endpoint?: { external?: boolean; backendUrl?: string },
) {
  const { buildPreviewSystemPrompt } = await import('./preview-prompt')
  const teamId = conversation.teamId

  if (!teamId) throw new Error('A workspace is required to restore model settings')
  const access = await previewSessionAccess(
    conversation.sessionId,
    teamId,
    conversation.userId,
    conversation.userId,
    {
      external: endpoint?.external,
      backendUrl: endpoint?.backendUrl,
      parentSessionId: conversation.parentSessionId,
    },
  )
  const provider = runtimeProvider(conversation.agentRuntime)
  const systemPrompt = await buildPreviewSystemPrompt({
    provider,
    runtimeId: conversation.runtimeId,
    userId: conversation.userId,
    teamId,
    sessionId: conversation.sessionId,
    locale: conversation.metadata?.locale ?? 'en',
    userTexts: [conversation.firstMessage],
    ...conversation.claudeCodePreviewContext,
  })

  return {
    cwd: RUNTIME_CWD,
    mcpServers: access.mcpServers,
    ...sessionMeta(systemPrompt, {
      provider,
      env: access.runtimeEnv,
      defaults: storedPick(conversation.claudeCodePreview),
      workingDirectory: workspaceDirectory(conversation, conversation.runtimeId),
    }),
  }
}
