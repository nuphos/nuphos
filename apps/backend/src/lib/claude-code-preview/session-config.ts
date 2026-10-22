import { agentConversations, liveAttachment } from '@/lib/agent/db/shared'
import { AppError } from '@/lib/errors'

import { resolveConversationChatRuntime } from './conversation-chat-route'
import { reachableRuntimeEndpoint } from './dev-runtime-forward'
import { OpenAbAcpClient } from './openab-acp-client'
import { OpenAbRpcError } from './openab-acp-errors'
import { runtimeModelCatalog } from './runtime-models'
import { offeredSessionConfig } from './session-config-catalog'
import { parseSessionConfigOptions, storedPick } from './session-config-options'
import { sessionConfigRestoreContext } from './session-config-restore'

import type { RuntimeDefaults } from './openab-acp-session'
import type { RuntimeModelCatalog } from './runtime-models'
import type {
  SessionConfigOption,
  SessionConfigSelection,
  SessionConfigState,
} from './session-config-options'
import type { AgentConversation } from '@/lib/agent/db'

export async function controlSessionConfig(
  client: Pick<OpenAbAcpClient, 'getSessionConfigOptions' | 'setSessionConfigOption'>,
  sessionId: string,
  selection?: SessionConfigSelection,
): Promise<SessionConfigState> {
  try {
    const options = parseSessionConfigOptions(
      (await client.getSessionConfigOptions(sessionId)).configOptions,
    )

    if (!selection) return { status: options.length ? 'ready' : 'unsupported', options }
    // The chip lists the runtime's catalog, which names each control by its kind.
    const option =
      options.find((entry) => entry.id === selection.configId) ??
      options.find((entry) => entry.kind === selection.configId)

    if (!option?.options.some((entry) => entry.value === selection.value)) {
      throw new AppError(
        400,
        'invalid_runtime_config',
        'This model setting is no longer available. Refresh and try again.',
      )
    }
    const updated = parseSessionConfigOptions(
      (await client.setSessionConfigOption(sessionId, option.id, selection.value)).configOptions,
    )

    return { status: updated.length ? 'ready' : 'unsupported', options: updated }
  } catch (error) {
    if (error instanceof OpenAbRpcError) {
      const status =
        error.code === -32004
          ? 'dormant'
          : error.code === -32005
            ? 'busy'
            : error.code === -32601
              ? 'unsupported'
              : null

      if (status && !selection) return { status, options: [] }
      if (status)
        throw new AppError(
          409,
          'runtime_config_unavailable',
          status === 'busy'
            ? 'Wait for the current reply to finish before changing model settings.'
            : 'The agent session could not be restored. Refresh and try again.',
        )
    }
    throw error
  }
}

export async function restoreSessionConfigForWrite(
  client: Pick<OpenAbAcpClient, 'getSessionConfigOptions' | 'setSessionConfigOption'>,
  sessionId: string,
  ownerUserId: string,
  viewerUserId: string | undefined,
  restoreContext: () => Promise<Record<string, unknown>>,
): Promise<SessionConfigState> {
  const state = await controlSessionConfig(client, sessionId)

  if (state.status !== 'dormant' || viewerUserId !== ownerUserId) return state
  try {
    const restored = await client.getSessionConfigOptions(sessionId, await restoreContext())
    const options = parseSessionConfigOptions(restored.configOptions)

    return { status: options.length ? 'ready' : 'unsupported', options }
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error instanceof OpenAbRpcError && error.code === -32005)
      return { status: 'busy', options: [] }
    if (error instanceof OpenAbRpcError && error.code === -32601)
      return { status: 'unsupported', options: [] }

    throw Object.assign(
      new AppError(
        409,
        'runtime_config_unavailable',
        'The saved session could not be restored. Try again.',
      ),
      { cause: error },
    )
  }
}

export async function conversationSessionConfig(
  conversation: AgentConversation,
  selection?: SessionConfigSelection,
  viewerUserId?: string,
): Promise<SessionConfigState> {
  const attachment = liveAttachment(conversation)

  if (!conversation.teamId) return { status: 'unsupported', options: [] }
  if (!attachment) return await initialSessionConfig(conversation, selection, viewerUserId)
  const catalogFor = runtimeCatalog(conversation, viewerUserId)

  if (!selection) return await sessionConfigView(storedPick(attachment), catalogFor)
  const picked = await applySessionConfig(conversation, attachment, selection, viewerUserId)

  return await sessionConfigView(picked, catalogFor)
}

type CatalogFor = ((model?: string) => Promise<RuntimeModelCatalog>) | undefined

function runtimeCatalog(conversation: AgentConversation, viewerUserId?: string): CatalogFor {
  const { teamId, runtimeId } = conversation

  return teamId && runtimeId
    ? (model) => runtimeModelCatalog(teamId, runtimeId, model, viewerUserId)
    : undefined
}

/**
 * A started conversation's chip: the runtime's own list with the session's
 * settings as current values. The session is never asked, so the list is the
 * same whether or not a reply is running (it cannot answer while one runs).
 */
export async function sessionConfigView(
  picked: RuntimeDefaults,
  catalogFor: CatalogFor,
): Promise<SessionConfigState> {
  const { status, options } = await catalogState(picked, catalogFor)

  return { status: status === 'dormant' ? 'ready' : status, options }
}

async function catalogState(
  picked: RuntimeDefaults,
  catalogFor: CatalogFor,
): Promise<SessionConfigState & { kept: RuntimeDefaults }> {
  if (!catalogFor) return { status: 'dormant', options: [], kept: {} }
  try {
    return { status: 'dormant', ...(await offeredSessionConfig(catalogFor, picked)) }
  } catch {
    return { status: 'offline', options: [], kept: {} }
  }
}

/**
 * Before a session exists the choices come from the runtime itself, and a pick
 * is kept on the conversation for the runtime to apply when it creates one.
 */
async function initialSessionConfig(
  conversation: AgentConversation,
  selection: SessionConfigSelection | undefined,
  viewerUserId: string | undefined,
): Promise<SessionConfigState> {
  const stored = conversation.initialSessionConfig ?? {}
  const { status, options, kept } = await catalogState(
    selection ? { ...stored, [selection.configId]: selection.value } : stored,
    runtimeCatalog(conversation, viewerUserId),
  )

  if (selection && status === 'offline')
    throw new AppError(409, 'runtime_unavailable', 'The conversation’s agent is unavailable.')
  if (
    selection &&
    options.find((option) => option.id === selection.configId)?.currentValue !== selection.value
  )
    throw new AppError(
      400,
      'invalid_runtime_config',
      'This model setting is no longer available. Refresh and try again.',
    )
  // Only before the session starts; afterwards the session holds its own settings.
  if (status !== 'offline' && JSON.stringify(kept) !== JSON.stringify(stored))
    await agentConversations().updateOne(
      {
        sessionId: conversation.sessionId,
        teamId: conversation.teamId,
        claudeCodePreview: { $exists: false },
      },
      { $set: { initialSessionConfig: kept } },
    )

  return { status, options }
}

/**
 * A change goes to the live session, and what it confirms becomes the session's
 * settings: shown from then on, and applied again if the session is recreated.
 */
async function applySessionConfig(
  conversation: AgentConversation,
  attachment: NonNullable<ReturnType<typeof liveAttachment>>,
  selection: SessionConfigSelection,
  viewerUserId?: string,
): Promise<RuntimeDefaults> {
  const { endpoint } = await resolveConversationChatRuntime(conversation.teamId, conversation)

  if (!endpoint || endpoint.url !== attachment.runtimeUrl)
    throw new AppError(409, 'runtime_unavailable', 'The conversation’s agent is unavailable.')
  // Do not session/resume here: it would claim the live output sink from
  // another backend replica. This connection only writes configuration.
  const client = await OpenAbAcpClient.connect({
    ...(await reachableRuntimeEndpoint(endpoint)),
    callTimeoutMs: 100_000,
  })

  try {
    await client.initialize()
    await restoreSessionConfigForWrite(
      client,
      attachment.openabSessionId,
      conversation.userId,
      viewerUserId,
      () => sessionConfigRestoreContext(conversation, endpoint),
    )
    const { options } = await controlSessionConfig(client, attachment.openabSessionId, selection)

    // Scoped to the session id so a newer session's settings are never overwritten.
    await agentConversations().updateOne(
      {
        sessionId: conversation.sessionId,
        teamId: conversation.teamId,
        'claudeCodePreview.openabSessionId': attachment.openabSessionId,
      },
      { $set: { 'claudeCodePreview.sessionConfig': options } },
    )

    return storedPick({ ...attachment, sessionConfig: options })
  } finally {
    client.close()
  }
}
