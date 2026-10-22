import { agentConversations, liveAttachment } from '@/lib/agent/db/shared'
import { AppError } from '@/lib/errors'

import { resolveConversationChatRuntime } from './conversation-chat-route'
import { reachableRuntimeEndpoint } from './dev-runtime-forward'
import { OpenAbAcpClient } from './openab-acp-client'
import { OpenAbRpcError } from './openab-acp-errors'
import { runtimeModelCatalog } from './runtime-models'
import { offeredSessionConfig, unansweredSessionConfig } from './session-config-catalog'
import { parseSessionConfigOptions } from './session-config-options'
import { sessionConfigRestoreContext } from './session-config-restore'

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
    const option = options.find((entry) => entry.id === selection.configId)

    if (!option?.options.some((entry) => entry.value === selection.value)) {
      throw new AppError(
        400,
        'invalid_runtime_config',
        'This model setting is no longer available. Refresh and try again.',
      )
    }
    const updated = parseSessionConfigOptions(
      (await client.setSessionConfigOption(sessionId, selection.configId, selection.value))
        .configOptions,
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
  if (selection) return await liveSessionConfig(conversation, attachment, selection, viewerUserId)
  // Reads never fail for a reachable conversation: while the session cannot
  // answer, show the settings it last confirmed, or else those it started with.
  const { teamId, runtimeId } = conversation
  const shown = () =>
    unansweredSessionConfig(
      attachment,
      runtimeId
        ? (model) => runtimeModelCatalog(teamId, runtimeId, model, viewerUserId)
        : undefined,
    )
  let state: SessionConfigState

  try {
    state = await liveSessionConfig(conversation, attachment)
  } catch {
    return { status: 'offline', options: await shown() }
  }
  if (state.status !== 'ready') return { ...state, options: await shown() }
  await rememberSessionConfig(conversation, attachment, state.options)

  return state
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
  const { teamId, runtimeId } = conversation

  if (!teamId || !runtimeId) return { status: 'dormant', options: [] }
  const stored = conversation.initialSessionConfig ?? {}
  let offered: Awaited<ReturnType<typeof offeredSessionConfig>>

  try {
    offered = await offeredSessionConfig(
      (model) => runtimeModelCatalog(teamId, runtimeId, model, viewerUserId),
      selection ? { ...stored, [selection.configId]: selection.value } : stored,
    )
  } catch (error) {
    if (selection) throw error

    return { status: 'offline', options: [] }
  }
  const { options, kept } = offered

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
  if (JSON.stringify(kept) !== JSON.stringify(stored))
    await agentConversations().updateOne(
      { sessionId: conversation.sessionId, teamId, claudeCodePreview: { $exists: false } },
      { $set: { initialSessionConfig: kept } },
    )

  return { status: 'dormant', options }
}

async function liveSessionConfig(
  conversation: AgentConversation,
  attachment: NonNullable<ReturnType<typeof liveAttachment>>,
  selection?: SessionConfigSelection,
  viewerUserId?: string,
): Promise<SessionConfigState> {
  const { endpoint } = await resolveConversationChatRuntime(conversation.teamId, conversation)

  if (!endpoint || endpoint.url !== attachment.runtimeUrl)
    throw new AppError(409, 'runtime_unavailable', 'The conversation’s agent is unavailable.')
  // Do not session/resume here: it would claim the live output sink from
  // another backend replica. This connection only reads/writes configuration.
  const client = await OpenAbAcpClient.connect({
    ...(await reachableRuntimeEndpoint(endpoint)),
    callTimeoutMs: 100_000,
  })

  try {
    await client.initialize()
    if (!selection) return await controlSessionConfig(client, attachment.openabSessionId)

    await restoreSessionConfigForWrite(
      client,
      attachment.openabSessionId,
      conversation.userId,
      viewerUserId,
      () => sessionConfigRestoreContext(conversation, endpoint),
    )
    const state = await controlSessionConfig(client, attachment.openabSessionId, selection)

    await rememberSessionConfig(conversation, attachment, state.options)

    return state
  } finally {
    client.close()
  }
}

/** Scoped to the session id so a newer session's settings are never overwritten. */
async function rememberSessionConfig(
  conversation: AgentConversation,
  attachment: NonNullable<ReturnType<typeof liveAttachment>>,
  options: SessionConfigOption[],
) {
  // Clients poll; skip the write when nothing changed.
  if (!options.length || JSON.stringify(options) === JSON.stringify(attachment.sessionConfig))
    return
  await agentConversations().updateOne(
    {
      sessionId: conversation.sessionId,
      teamId: conversation.teamId,
      'claudeCodePreview.openabSessionId': attachment.openabSessionId,
    },
    { $set: { 'claudeCodePreview.sessionConfig': options } },
  )
}
