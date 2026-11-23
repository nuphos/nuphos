import { updateConversationSettings } from '@/lib/agent/db/settings-history'

import { settledCodexStopReason } from './codex-turn-settle'
import { parseSessionConfigOptions } from './session-config-options'

import type { OpenAbAcpClient } from './openab-acp-client'
import type { RuntimeDefaults } from './openab-acp-session'
import type { SessionConfigOption } from './session-config-options'
import type { TeamSession } from './team-openab-runtime'
import type { SettingsChangeBy } from '@/lib/agent/db/settings-history'
import type { ConversationPreviewAttachment } from '@/lib/agent/db/shared'

/** A session attachment with the model picks its conversation queued for itself; its next prompt confirms them. */
export type QueuedAttachment = ConversationPreviewAttachment & {
  pendingSessionConfig?: RuntimeDefaults
}

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

/** Drops one of a conversation's queued picks for itself once the session confirmed, refused or replaced it. */
export async function clearPendingSessionConfig(
  conversationId: string,
  teamId: string | undefined,
  attachment: QueuedAttachment,
  configId: keyof RuntimeDefaults,
  by: SettingsChangeBy,
): Promise<QueuedAttachment> {
  if (attachment.pendingSessionConfig?.[configId] === undefined) return attachment
  const pendingSessionConfig = { ...attachment.pendingSessionConfig }

  delete pendingSessionConfig[configId]
  // Replace only the object consumed here; a newer pick stays queued for another turn.
  await updateConversationSettings(
    {
      sessionId: conversationId,
      teamId,
      'claudeCodePreview.openabSessionId': attachment.openabSessionId,
      'claudeCodePreview.pendingSessionConfig': attachment.pendingSessionConfig,
    },
    { $set: { 'claudeCodePreview.pendingSessionConfig': pendingSessionConfig } },
    by,
  )

  return { ...attachment, pendingSessionConfig }
}

/** A manual pick supersedes the conversation's own queued pick for the same setting. */
export async function clearReplacedPick(
  conversationId: string,
  teamId: string | undefined,
  attachment: QueuedAttachment,
  options: SessionConfigOption[],
  configId: string,
  by: SettingsChangeBy,
): Promise<QueuedAttachment> {
  const kind = options.find((entry) => entry.id === configId || entry.kind === configId)?.kind

  return kind
    ? await clearPendingSessionConfig(conversationId, teamId, attachment, kind, by)
    : attachment
}
