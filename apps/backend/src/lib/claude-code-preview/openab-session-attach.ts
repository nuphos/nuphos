import {
  agentConversations,
  getConversationPreviewAttachment,
  markConversationWorkLost,
  setConversationPreviewAttachment,
} from '@/lib/agent/db'
import { logEvent } from '@/lib/observability'

import {
  assertConversationRuntimeAvailable,
  assertRuntimeNotDeleting,
} from './runtime-portability-store'
import { previewRuntimeCwd } from './team-openab-runtime'

import type { AcpHttpMcpServer } from './openab-acp-client'
import type { OpenAbSessionRuntime, RuntimeDefaults } from './openab-acp-session'
import type { TeamPreviewClient, TeamRuntimeEndpoint } from './team-openab-runtime'

/**
 * Reattach to the conversation's durable OpenAB session, or create one. The
 * mapping lives on the conversation doc so ANY backend replica resumes the
 * same inner session. A stale mapping — runtime changed, or the pod behind it
 * restarted and dropped the session — falls through to a fresh session, which
 * is recorded as the new attachment.
 */
export async function attachOpenAbSession(
  client: TeamPreviewClient,
  teamId: string,
  conversationId: string,
  endpoint: TeamRuntimeEndpoint,
  mcpServers: AcpHttpMcpServer[],
  systemPrompt: string | undefined,
  runtime: OpenAbSessionRuntime | undefined,
  onResume?: (sessionId: string, defaults: RuntimeDefaults) => void,
): Promise<{ openabSessionId: string; fresh: boolean; defaults: RuntimeDefaults }> {
  await assertConversationRuntimeAvailable(conversationId)
  await assertRuntimeNotDeleting(teamId, endpoint.runtimeId, endpoint.url)
  const cwd = previewRuntimeCwd(conversationId)
  const stored = await getConversationPreviewAttachment(conversationId, teamId)

  // The settings a session starts with are fixed with its attachment, so any
  // backend replica recreating it later applies the same ones.
  const defaults =
    (stored
      ? stored.runtimeDefaults
      : (
          await agentConversations().findOne(
            { sessionId: conversationId, teamId },
            { projection: { initialSessionConfig: 1 } },
          )
        )?.initialSessionConfig) ?? {}
  const sessionRuntime = { ...runtime, defaults }

  if (stored?.runtimeUrl === endpoint.url) {
    // Resuming may immediately replay output, before the RPC response.
    onResume?.(stored.openabSessionId, defaults)
    const { alive } = await client.loadSession(
      stored.openabSessionId,
      cwd,
      mcpServers,
      systemPrompt,
      sessionRuntime,
    )

    // Resume succeeded at the gateway, but the pool may have lost the
    // inner agent session (pod restarted, idle reap). Keep the placement
    // and session id, but treat the turn as fresh so the history preamble
    // restores the conversation's context.
    if (!alive) {
      logEvent('warn', 'agent.openab_session.inner_session_lost', {
        team_id: teamId,
        session_id: conversationId,
        openab_session_id: stored.openabSessionId,
      })
      await markConversationWorkLost(conversationId, teamId, 'session_lost')
    }

    return { openabSessionId: stored.openabSessionId, fresh: !alive, defaults }
  }
  const openabSessionId = await client.createSession(cwd, mcpServers, systemPrompt, sessionRuntime)

  // Placement is part of the conversation's durable identity. Never start a
  // prompt on process-local state if another replica could not recover this
  // exact runtime/session binding.
  await setConversationPreviewAttachment(conversationId, teamId, {
    openabSessionId,
    runtimeUrl: endpoint.url,
    runtimeDefaults: defaults,
  })

  return { openabSessionId, fresh: true, defaults }
}
