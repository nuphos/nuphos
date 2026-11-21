import { updateConversationSettings } from '@/lib/agent/db/settings-history'

import { settledCodexStopReason } from './codex-turn-settle'
import { parseSessionConfigOptions } from './session-config-options'

import type { OpenAbAcpClient } from './openab-acp-client'
import type { SessionConfigOption } from './session-config-options'
import type { TeamSession } from './team-openab-runtime'
import type { SettingsChangeBy } from '@/lib/agent/db/settings-history'

/**
 * A session's settings as the chip reads them. Scoped to the session id, so a newer
 * session's are never overwritten, and written only when they changed: a session
 * reports them with every turn (#3789).
 */
export async function storeSessionConfig(
  conversationId: string,
  teamId: string | undefined,
  openabSessionId: string,
  options: SessionConfigOption[],
  by: SettingsChangeBy,
) {
  await updateConversationSettings(
    {
      sessionId: conversationId,
      teamId,
      'claudeCodePreview.openabSessionId': openabSessionId,
      'claudeCodePreview.sessionConfig': { $ne: options },
    },
    { $set: { 'claudeCodePreview.sessionConfig': options } },
    by,
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

    // What the session reports after a turn is the agent's own doing.
    if (options.length)
      await storeSessionConfig(conversationId, teamId, openabSessionId, options, {
        actorId: 'system',
        via: 'runtime_reported',
      })
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
