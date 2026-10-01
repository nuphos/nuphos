import { resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import { developmentRuntimeEndpoint, requireRuntimeInstance } from './runtime-catalog'
import { listTeamRuntimes, resolveTeamRuntimeEndpoints } from './runtime-registry'
import {
  assertClaudeCodeSetupConfigured,
  resolveConversationAgentRuntime,
  resolveConversationRuntimeId,
  selectClaudeCodeChatEndpoint,
} from './runtime-routing'

import type { OpenAbProvider } from './runtime-provider'
import type { ConversationAgentRuntime } from './runtime-routing'
import type { TeamRuntimeEndpoint } from './team-openab-runtime'
import type { AgentConversation } from '@/lib/agent/db'

import { stampConversationAgentRuntime, stampConversationRuntimeInstance } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'
import { getTeamAgentRuntime } from '@/lib/identity'

export type ConversationChatRuntime = {
  runtime: ConversationAgentRuntime
  runtimeId?: string
  runtimeLabel?: string
  endpoint: TeamRuntimeEndpoint
}

export type ConversationChatRequest = {
  /** Who acts this turn; defaults to the conversation's owner. */
  userId?: string
  runtime?: OpenAbProvider
  runtimeId?: string
  purpose?: 'transport' | 'control'
}

/** Resolve every conversation onto the supported OpenAB runtime and placement. */
export async function resolveConversationChatRuntime(
  teamId: string | undefined,
  conversation: Pick<
    AgentConversation,
    'sessionId' | 'userId' | 'agentRuntime' | 'claudeCodePreview' | 'runtimeId'
  > | null,
  request: ConversationChatRequest = {},
): Promise<ConversationChatRuntime> {
  const { runtime: requestedRuntime, purpose = 'transport' } = request
  const pinned = Boolean(conversation?.agentRuntime || conversation?.claudeCodePreview)
  const selectedId = resolveConversationRuntimeId(conversation, request.runtimeId)
  const actor = request.userId ?? conversation?.userId
  // A local agent runs only its owner's own conversations, acted on by that owner.
  const localAgentUser = conversation && conversation.userId !== actor ? undefined : actor

  if (selectedId && !teamId)
    throw new AppError(400, 'invalid_request', 'An agent requires a workspace')
  const instance =
    selectedId && teamId
      ? await requireRuntimeInstance(teamId, selectedId, localAgentUser)
      : undefined

  if (instance?.status === 'disabled')
    throw new AppError(
      409,
      'runtime_disabled',
      'This conversation’s agent is disabled. Enable it in Settings → Agent, or start a new conversation with another agent.',
    )
  const needsTeamDefault = !instance && !requestedRuntime && !pinned
  const teamDefault = needsTeamDefault && teamId ? await getTeamAgentRuntime(teamId) : 'claude-code'
  const runtime =
    instance?.provider ??
    resolveConversationAgentRuntime(conversation, teamDefault, requestedRuntime)

  if (conversation && !conversation.agentRuntime) {
    await stampConversationAgentRuntime(conversation.sessionId, runtime)
  }
  if (!teamId) throw new Error('OpenAB conversation is missing its Team scope.')
  if (instance?.kind === 'local' && localAgentUser) {
    const endpoint = await resolveLocalRuntimeEndpoint(teamId, instance.id, localAgentUser, purpose)

    if (conversation && !conversation.runtimeId)
      await stampConversationRuntimeInstance(conversation.sessionId, instance.id, instance.label)

    return { runtime, endpoint, runtimeId: instance.id, runtimeLabel: instance.label }
  }
  const developmentEndpoint = developmentRuntimeEndpoint(runtime, purpose)

  if (
    developmentEndpoint &&
    (selectedId
      ? selectedId === developmentEndpoint.runtimeId
      : !conversation?.claudeCodePreview ||
        conversation.claudeCodePreview.runtimeUrl === developmentEndpoint.url)
  ) {
    const runtimeId = developmentEndpoint.runtimeId
    const runtimeLabel =
      instance?.label ?? `${runtime === 'codex' ? 'Codex' : 'Claude Code'} (local development)`
    const endpoint = selectClaudeCodeChatEndpoint(
      runtime,
      [developmentEndpoint],
      conversation?.claudeCodePreview?.runtimeUrl,
      runtimeId,
    )

    if (conversation && !conversation.runtimeId) {
      await stampConversationRuntimeInstance(conversation.sessionId, runtimeId, runtimeLabel)
    }

    return {
      runtime,
      endpoint,
      runtimeId,
      runtimeLabel,
    }
  }
  const registered = await resolveTeamRuntimeEndpoints(teamId, undefined, runtime, purpose)
  const endpoints = selectedId
    ? registered.filter((endpoint) => endpoint.runtimeId === selectedId)
    : registered

  if (endpoints.length === 0 && !selectedId)
    assertClaudeCodeSetupConfigured((await listTeamRuntimes(teamId, runtime)).length > 0, runtime)
  const endpoint = selectClaudeCodeChatEndpoint(
    runtime,
    endpoints,
    conversation?.claudeCodePreview?.runtimeUrl,
    selectedId,
  )

  const runtimeId = selectedId ?? endpoint?.runtimeId
  const runtimeLabel =
    instance?.label ??
    (runtimeId ? (await requireRuntimeInstance(teamId, runtimeId)).label : undefined)

  if (conversation && !conversation.runtimeId && runtimeId) {
    await stampConversationRuntimeInstance(conversation.sessionId, runtimeId, runtimeLabel)
  }

  return { runtime, endpoint, runtimeId, runtimeLabel }
}
