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

/**
 * One-time backfill: earlier versions kept a session's confirmed settings in
 * `claudeCodePreview.sessionConfig`. Fold them into `runtimeDefaults`, which the
 * chip and a recreated session read. Idempotent — a no-op once none remain.
 */
export async function migrateConfirmedSessionConfig(): Promise<number> {
  const legacy = await agentConversations()
    .find(
      { 'claudeCodePreview.sessionConfig': { $exists: true } },
      { projection: { sessionId: 1, teamId: 1, claudeCodePreview: 1 } },
    )
    .toArray()

  for (const conversation of legacy) {
    const attachment = conversation.claudeCodePreview as LegacyAttachment & {
      openabSessionId: string
    }

    await agentConversations().updateOne(
      {
        sessionId: conversation.sessionId,
        teamId: conversation.teamId,
        'claudeCodePreview.openabSessionId': attachment.openabSessionId,
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
