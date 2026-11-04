import { ObjectId } from 'mongodb'

import { stampConversationAgentRuntime, stampConversationRuntimeInstance } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'
import { getTeamAgentRuntime } from '@/lib/identity'
import { userTeamRuntimeFallbacks } from '@/models'

import { resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import {
  developmentRuntimeEndpoint,
  listRuntimeInstances,
  requireRuntimeInstance,
} from './runtime-catalog'
import { runtimeLabel as providerLabel } from './runtime-provider'
import { listTeamRuntimes, resolveTeamRuntimeEndpoints } from './runtime-registry'
import {
  assertClaudeCodeSetupConfigured,
  defaultConversationRuntimeId,
  resolveConversationAgentRuntime,
  resolveConversationRuntimeId,
  selectClaudeCodeChatEndpoint,
} from './runtime-routing'

import type { OpenAbProvider } from './runtime-provider'
import type { ConversationAgentRuntime } from './runtime-routing'
import type { TeamRuntimeEndpoint } from './team-openab-runtime'
import type { AgentConversation } from '@/lib/agent/db'

export type ConversationChatRuntime = {
  runtime: ConversationAgentRuntime
  runtimeId?: string
  runtimeLabel?: string
  endpoint: TeamRuntimeEndpoint
}

export type ConversationChatRequest = {
  /** Who acts this turn; defaults to the conversation's owner. */
  userId?: string
  /** Who owns a conversation not stored yet (a channel's binding owner); defaults to the actor. */
  ownerUserId?: string
  runtime?: OpenAbProvider
  runtimeId?: string
  purpose?: 'transport' | 'control'
  /** The conversation this turn is for, even before it is stored; a shared computer asks about it. */
  sessionId?: string
  /** Where this turn comes from (a channel or trigger), which may differ from where the conversation began. */
  source?: string
}

async function ownerDefaultRuntimeId(
  teamId: string,
  ownerId: string,
  provider: OpenAbProvider | undefined,
): Promise<string | undefined> {
  const [instances, fallbacks] = await Promise.all([
    listRuntimeInstances(teamId, ownerId),
    userTeamRuntimeFallbacks().findOne({ teamId: new ObjectId(teamId), userId: ownerId }),
  ])

  return defaultConversationRuntimeId(instances, fallbacks?.runtimeIds ?? [], provider)
}

/** Resolve every conversation onto the supported OpenAB runtime and placement. */
export async function resolveConversationChatRuntime(
  teamId: string | undefined,
  conversation:
    | (Pick<
        AgentConversation,
        'sessionId' | 'userId' | 'agentRuntime' | 'claudeCodePreview' | 'runtimeId'
      > &
        Partial<Pick<AgentConversation, 'metadata'>>)
    | null,
  request: ConversationChatRequest = {},
): Promise<ConversationChatRuntime> {
  const { runtime: requestedRuntime, purpose = 'transport' } = request
  const pinned = Boolean(conversation?.agentRuntime || conversation?.claudeCodePreview)
  const actor = request.userId ?? conversation?.userId
  const owner = conversation ? conversation.userId : (request.ownerUserId ?? actor)
  // A stored conversation's computer serves whoever may use it; a new one's only its owner.
  const localAgentUser = conversation || owner === actor ? actor : undefined
  // Nothing pins an agent (a trigger's or channel's first turn): the owner's own default.
  const selectedId =
    resolveConversationRuntimeId(conversation, request.runtimeId) ??
    (teamId && owner === actor && actor && !pinned
      ? await ownerDefaultRuntimeId(teamId, actor, requestedRuntime)
      : undefined)

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
    const runtimeLabel = instance?.label ?? `${providerLabel(runtime)} (local development)`
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
