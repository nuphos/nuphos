import { liveAttachment } from '@/lib/agent/db/shared'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { controlSessionConfig, runtimeCatalog } from './session-config'
import { catalogState } from './session-config-catalog'
import { storedPick } from './session-config-options'
import { clearPendingSessionConfig, storeSessionConfig } from './session-config-record'
import { turnDefaults } from './session-context'

import type { OpenAbAcpClient } from './openab-acp-client'
import type { RuntimeDefaults } from './openab-acp-session'
import type { SessionConfigState } from './session-config-options'
import type { TeamSession } from './team-openab-runtime'
import type { AgentConversation } from '@/lib/agent/db'
import type { ConversationPreviewAttachment } from '@/lib/agent/db/shared'

/** Validate a Bot's picks without writing its busy session; updateBotSelf saves the result. */
export async function botSessionConfigUpdate(
  conversation: AgentConversation,
  pick: Pick<RuntimeDefaults, 'model' | 'effort'>,
  viewerUserId?: string,
): Promise<{
  initialSessionConfig?: RuntimeDefaults
  pendingSessionConfig?: RuntimeDefaults
}> {
  if (!pick.model && !pick.effort) return {}
  const attachment = liveAttachment(conversation)
  const stored = attachment ? storedPick(attachment) : (conversation.initialSessionConfig ?? {})
  const { status, options, kept } = await catalogState(
    { ...stored, ...pick },
    runtimeCatalog(conversation, viewerUserId),
    !attachment && Boolean(conversation.runtimeMigration),
  )

  if (status === 'offline')
    throw new AppError(409, 'runtime_unavailable', 'The conversation’s agent is unavailable.')

  for (const configId of ['model', 'effort'] as const) {
    const value = pick[configId]

    if (value === undefined) continue
    const option = options.find((entry) => entry.id === configId)

    if (option?.currentValue === value) continue
    const choices = option?.options ?? []

    throw new Error(
      `${configId} "${value}" is not offered by the Bot's agent. Choose one of: ${
        choices.map((choice) => choice.value).join(', ') || 'none'
      }.`,
    )
  }

  return attachment ? { pendingSessionConfig: pick } : { initialSessionConfig: kept }
}

/** The turn's model settings, once the picks a Bot queued for it are confirmed. */
export async function pendingTurnDefaults(
  client: Pick<OpenAbAcpClient, 'getSessionConfigOptions' | 'setSessionConfigOption'>,
  session: TeamSession,
  attachment: ConversationPreviewAttachment | null,
): Promise<RuntimeDefaults | undefined> {
  return turnDefaults(
    session,
    attachment?.pendingSessionConfig
      ? await applyPendingSessionConfig(client, session.conversationId, session.teamId, attachment)
      : attachment,
  )
}

/** Confirm queued settings before a prompt: model first, then that model's effort. */
export async function applyPendingSessionConfig(
  client: Pick<OpenAbAcpClient, 'getSessionConfigOptions' | 'setSessionConfigOption'>,
  conversationId: string,
  teamId: string | undefined,
  attachment: ConversationPreviewAttachment,
): Promise<ConversationPreviewAttachment> {
  let current = attachment

  for (const configId of ['model', 'effort'] as const) {
    const value = current.pendingSessionConfig?.[configId]

    if (value === undefined) continue
    let options: SessionConfigState['options']

    try {
      ;({ options } = await controlSessionConfig(client, current.openabSessionId, {
        configId,
        value,
      }))
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'invalid_runtime_config') throw error
      // The agent no longer offers this pick. Drop it so later prompts run on the
      // last confirmed settings instead of failing every turn. Logged, not retried.
      logError('agent.session.pending_config_rejected', error, {
        session_id: conversationId,
        config_id: configId,
      })
      current = await clearPendingSessionConfig(conversationId, teamId, current, configId)
      continue
    }

    await storeSessionConfig(conversationId, teamId, current.openabSessionId, options)
    current = await clearPendingSessionConfig(conversationId, teamId, current, configId)
    current = { ...current, sessionConfig: options }
  }

  return current
}
