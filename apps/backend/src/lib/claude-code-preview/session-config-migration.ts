import { agentConversations } from '@/lib/agent/db/shared'
import { logEvent } from '@/lib/observability'

import { pickOf } from './session-config'

import type { RuntimeDefaults } from './openab-acp-session'
import type { SessionConfigOption } from './session-config-options'

type LegacyAttachment = { runtimeDefaults?: RuntimeDefaults; sessionConfig?: SessionConfigOption[] }

/** Settings a session confirmed before they were stored by kind win over its start settings. */
export function migratedRuntimeDefaults(attachment: LegacyAttachment): RuntimeDefaults {
  return { ...attachment.runtimeDefaults, ...pickOf(attachment.sessionConfig ?? []) }
}

type Conversations = Pick<ReturnType<typeof agentConversations>, 'find' | 'updateOne'>

/**
 * One-time backfill: earlier versions kept a session's confirmed settings in
 * `claudeCodePreview.sessionConfig`. Fold them into `runtimeDefaults`, which the
 * chip and a recreated session read. Idempotent — a no-op once none remain.
 *
 * Every replica runs it at startup, so each write is a compare-and-set on the
 * snapshot it read: once the old field is gone, or a newer pick was stored, a
 * stale write matches nothing.
 */
export async function migrateConfirmedSessionConfig(
  conversations: Conversations = agentConversations(),
): Promise<number> {
  const legacy = await conversations
    .find(
      { 'claudeCodePreview.sessionConfig': { $exists: true } },
      { projection: { sessionId: 1, teamId: 1, claudeCodePreview: 1 } },
    )
    .toArray()

  for (const conversation of legacy) {
    const attachment = conversation.claudeCodePreview as LegacyAttachment & {
      openabSessionId: string
    }

    await conversations.updateOne(
      {
        sessionId: conversation.sessionId,
        teamId: conversation.teamId,
        'claudeCodePreview.openabSessionId': attachment.openabSessionId,
        'claudeCodePreview.sessionConfig': attachment.sessionConfig,
        'claudeCodePreview.runtimeDefaults': attachment.runtimeDefaults ?? { $exists: false },
      },
      {
        $set: { 'claudeCodePreview.runtimeDefaults': migratedRuntimeDefaults(attachment) },
        $unset: { 'claudeCodePreview.sessionConfig': '' },
      },
    )
  }

  if (legacy.length)
    logEvent('info', 'backend.migration.session_config_folded', { conversations: legacy.length })

  return legacy.length
}
