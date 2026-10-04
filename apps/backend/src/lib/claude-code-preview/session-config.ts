import { agentConversations, liveAttachment } from '@/lib/agent/db/shared'
import { AppError } from '@/lib/errors'

import { resolveConversationChatRuntime } from './conversation-chat-route'
import { reachableRuntimeEndpoint } from './dev-runtime-forward'
import { OpenAbAcpClient } from './openab-acp-client'
import { OpenAbRpcError } from './openab-acp-errors'
import { sessionConfigRestoreContext } from './session-config-restore'

import type { AgentConversation } from '@/lib/agent/db'

export type SessionConfigOption = {
  id: string
  name: string
  kind: 'model' | 'effort' | 'fast'
  description?: string
  currentValue: string
  options: { value: string; name: string; description?: string }[]
}
export type SessionConfigState = {
  status: 'ready' | 'busy' | 'dormant' | 'unsupported' | 'offline'
  options: SessionConfigOption[]
}
export type SessionConfigSelection = { configId: string; value: string }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function configKind(option: Record<string, unknown>): SessionConfigOption['kind'] | null {
  if (option.category === 'model' || option.id === 'model') return 'model'
  if (
    ['reasoning_effort', 'effort', 'thinking'].includes(String(option.id)) ||
    option.category === 'thought_level'
  )
    return 'effort'
  if (['fast-mode', 'fast_mode', 'fast'].includes(String(option.id))) return 'fast'

  return null
}

/** Expose only runtime-advertised model controls, never permission or tool modes. */
export function parseSessionConfigOptions(value: unknown): SessionConfigOption[] {
  if (!Array.isArray(value)) throw new Error('Runtime did not return configuration options')

  return value.flatMap((raw) => {
    const option = record(raw)
    const kind = option && configKind(option)

    if (
      !option ||
      !kind ||
      typeof option.id !== 'string' ||
      typeof option.name !== 'string' ||
      typeof option.currentValue !== 'string' ||
      !Array.isArray(option.options)
    )
      return []
    const choices = option.options.flatMap((rawChoice: unknown) => {
      const choice = record(rawChoice)

      if (!choice || typeof choice.value !== 'string' || typeof choice.name !== 'string') return []

      return [
        {
          value: choice.value,
          name: choice.name,
          ...(typeof choice.description === 'string' ? { description: choice.description } : {}),
        },
      ]
    })

    return [
      {
        id: option.id,
        name: option.name,
        kind,
        currentValue: option.currentValue,
        options: choices,
        ...(typeof option.description === 'string' ? { description: option.description } : {}),
      },
    ]
  })
}

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
  if (!attachment) {
    if (selection)
      throw new AppError(409, 'runtime_not_started', 'Send a message to start this agent first.')

    return { status: 'dormant', options: [] }
  }
  if (selection) return await liveSessionConfig(conversation, attachment, selection, viewerUserId)
  // Reads never fail for a reachable conversation: while the session cannot
  // answer, show the settings it last confirmed.
  const remembered = attachment.sessionConfig ?? []
  let state: SessionConfigState

  try {
    state = await liveSessionConfig(conversation, attachment)
  } catch {
    return { status: 'offline', options: remembered }
  }
  if (state.status !== 'ready') return { ...state, options: remembered }
  await rememberSessionConfig(conversation, attachment, state.options)

  return state
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
