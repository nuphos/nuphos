import { AppError } from '@/lib/errors'

import {
  OPENAB_PROVIDERS,
  isOpenAbProvider,
  runtimeErrorPrefix,
  runtimeLabel,
  runtimeProvider,
} from './runtime-provider'

import type { RuntimeInstance } from './runtime-instances'
import type { OpenAbProvider } from './runtime-provider'
import type { TeamRuntimeEndpoint } from './team-openab-runtime'
import type { AgentConversation } from '@/lib/agent/db'

export type ConversationAgentRuntime = OpenAbProvider

export function assertClaudeCodeSetupConfigured(
  hasRuntime: boolean,
  provider: OpenAbProvider = 'claude-code',
): void {
  if (hasRuntime) return

  throw new AppError(
    409,
    `${runtimeErrorPrefix(provider)}_setup_required`,
    `${runtimeLabel(provider)} is not set up in this workspace yet. A workspace administrator must add an agent on the Runtimes page and sign it in before using Agent.`,
  )
}

/**
 * The agent a conversation nothing pins runs on: the first usable agent in its owner's
 * fallback list, else the owner's own signed-in agent on any computer they may use, shared
 * ones included, most recently used first: signing in to it is the choice. A local agent
 * belongs to whoever added it, else to the computer's owner, so another member's never runs.
 */
export function defaultConversationRuntimeId(
  instances: readonly Pick<RuntimeInstance, 'id' | 'provider' | 'status' | 'kind' | 'local'>[],
  userId: string,
  {
    fallbackIds = [],
    recentIds = [],
    provider,
  }: {
    fallbackIds?: readonly string[]
    /** The agents of the owner's latest conversations, most recent first. */
    recentIds?: readonly string[]
    provider?: OpenAbProvider
  } = {},
): string | undefined {
  const usable = (instance: (typeof instances)[number]) =>
    instance.status === 'active' &&
    (!provider || instance.provider === provider) &&
    (instance.kind !== 'local' ||
      Boolean(
        instance.local?.online &&
        instance.local.signedIn !== false &&
        (instance.local.addedBy?.userId ?? instance.local.ownerUserId) === userId,
      ))
  const listed = fallbackIds
    .map((id) => instances.find((instance) => instance.id === id))
    .find((instance) => instance && usable(instance))

  if (listed) return listed.id
  const rank = (id: string) => (recentIds.includes(id) ? recentIds.indexOf(id) : Infinity)

  return instances
    .filter((instance) => instance.kind === 'local' && usable(instance))
    .sort((a, b) => rank(a.id) - rank(b.id))[0]?.id
}

export function validateRequestedAgentRuntime(
  value: unknown,
): asserts value is OpenAbProvider | undefined {
  if (value !== undefined && !isOpenAbProvider(value)) {
    throw new AppError(
      400,
      'invalid_request',
      `agentRuntime must be one of ${OPENAB_PROVIDERS.join(', ')}`,
    )
  }
}

export function validateRequestedRuntimeId(value: unknown): asserts value is string | undefined {
  if (
    value !== undefined &&
    (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/u.test(value))
  ) {
    throw new AppError(400, 'invalid_request', 'runtimeId must identify a runtime instance')
  }
}

/** Existing conversations cannot be reassigned, including to another account of the same provider. */
export function resolveConversationRuntimeId(
  conversation: Pick<AgentConversation, 'agentRuntime' | 'claudeCodePreview' | 'runtimeId'> | null,
  requestedId?: string,
): string | undefined {
  return (
    conversation?.runtimeId ??
    (conversation?.agentRuntime || conversation?.claudeCodePreview ? undefined : requestedId)
  )
}

/** Native transcripts belong to the server, from the first message onward. */
export function isServerAuthoritativeTranscript(
  conversation: Pick<AgentConversation, 'agentRuntime' | 'claudeCodePreview' | 'kind'> | null,
  requestedRuntime?: OpenAbProvider,
): boolean {
  // A channel's messages are each posted to the server by their own sender.
  return Boolean(
    conversation?.kind === 'channel' ||
    isOpenAbProvider(conversation ? conversation.agentRuntime : requestedRuntime) ||
    conversation?.claudeCodePreview,
  )
}

/** A creation preference never overrides an existing conversation's provider. */
export function resolveConversationAgentRuntime(
  conversation: Pick<AgentConversation, 'agentRuntime' | 'claudeCodePreview'> | null,
  teamDefault: ConversationAgentRuntime,
  requestedRuntime?: OpenAbProvider,
): ConversationAgentRuntime {
  if (conversation?.agentRuntime || conversation?.claudeCodePreview)
    return runtimeProvider(conversation.agentRuntime)

  return requestedRuntime ?? runtimeProvider(teamDefault)
}

/** Keep the conversation's runtime and concrete ACP placement authoritative. */
export function selectClaudeCodeChatEndpoint(
  runtime: ConversationAgentRuntime,
  endpoints: TeamRuntimeEndpoint[],
  attachedRuntimeUrl?: string,
  runtimeId?: string,
): TeamRuntimeEndpoint {
  const candidates = runtimeId
    ? endpoints.filter((endpoint) => endpoint.runtimeId === runtimeId)
    : endpoints
  const endpoint = attachedRuntimeUrl
    ? candidates.find((candidate) => candidate.url === attachedRuntimeUrl)
    : candidates[0]

  if (!endpoint) {
    throw new AppError(
      503,
      `${runtimeErrorPrefix(runtime)}_runtime_${attachedRuntimeUrl ? 'unavailable' : 'starting'}`,
      attachedRuntimeUrl
        ? `The ${runtimeLabel(runtime)} agent attached to this conversation is unavailable. It will not be moved to another agent; restore the attached agent, then retry.`
        : `${runtimeLabel(runtime)} agent is selected for this conversation, but it is not ready yet. Wait for the agent to come online, then retry.`,
    )
  }

  return endpoint
}
