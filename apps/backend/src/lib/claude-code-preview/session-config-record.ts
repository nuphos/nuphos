import { agentConversations } from '@/lib/agent/db/shared'

import { settledCodexStopReason } from './codex-turn-settle'
import { parseSessionConfigOptions } from './session-config-options'

import type { OpenAbAcpClient } from './openab-acp-client'
import type { SessionConfigOption } from './session-config-options'
import type { TeamSession } from './team-openab-runtime'

/** A session's settings as the chip reads them. Scoped to the session id, so a newer session's are never overwritten. */
export async function storeSessionConfig(
  conversationId: string,
  teamId: string | undefined,
  openabSessionId: string,
  options: SessionConfigOption[],
) {
  await agentConversations().updateOne(
    { sessionId: conversationId, teamId, 'claudeCodePreview.openabSessionId': openabSessionId },
    { $set: { 'claudeCodePreview.sessionConfig': options } },
  )
}

/**
 * Store what the session runs now. The runtime changes settings on its own
 * (Claude Code turns fast mode off when the account has no extra usage), and a
 * chat started on the agent's defaults has picked none, so a chip built only
 * from picks shows wrong values or none. A busy or gone session keeps the
 * settings stored last.
 */
export async function recordSessionConfig(
  client: Pick<OpenAbAcpClient, 'getSessionConfigOptions'>,
  conversationId: string,
  teamId: string | undefined,
  openabSessionId: string,
) {
  try {
    const result = await client.getSessionConfigOptions(openabSessionId)
    const options = parseSessionConfigOptions(result.configOptions)

    if (options.length) await storeSessionConfig(conversationId, teamId, openabSessionId, options)
  } catch {
    // The reply already succeeded; the chip keeps its last stored settings.
  }
}

/** A finished reply's stop reason, once the settings it ran on are stored for the chip. */
export async function settledTurn(
  client: Pick<OpenAbAcpClient, 'getSessionConfigOptions'>,
  session: TeamSession,
  result: Record<string, unknown>,
  lastTextChunk: string,
): Promise<string> {
  await recordSessionConfig(client, session.conversationId, session.teamId, session.openabSessionId)

  return settledCodexStopReason(session, result, lastTextChunk)
}
