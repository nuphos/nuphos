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
 * The agent a conversation nothing pins runs on: a ready team agent, else the owner's first
 * online Box agent, else the owner's own signed-in agent on any computer they may use, shared
 * ones included, most recently used first. Only that last step reaches a teammate's shared
 * computer: an agent there is the owner's when they added it, so another member's is never chosen.
 */
export function defaultConversationRuntimeId(
  instances: readonly Pick<
    RuntimeInstance,
    'id' | 'provider' | 'status' | 'kind' | 'local' | 'notReady'
  >[],
  userId: string,
  {
    recentIds = [],
    provider,
  }: {
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
        instance.local?.online && !instance.local.shared && instance.local.signedIn !== false,
      ))

  // A ready team agent runs it: the caller resolves the team's own.
  if (
    instances.some(
      (instance) => instance.kind !== 'local' && !instance.notReady && usable(instance),
    )
  )
    return undefined
  const box = instances.find((instance) => instance.local?.box && usable(instance))

  if (box) return box.id
  // Nothing else could run it: the owner signing in to an agent is the choice.
  const own = (instance: (typeof instances)[number]) =>
    instance.status === 'active' &&
    (!provider || instance.provider === provider) &&
    Boolean(
      instance.local?.online &&
      instance.local.signedIn !== false &&
      (instance.local.addedBy?.userId ?? instance.local.ownerUserId) === userId,
    )
  const rank = (id: string) => (recentIds.includes(id) ? recentIds.indexOf(id) : Infinity)

  return instances.filter(own).sort((a, b) => rank(a.id) - rank(b.id))[0]?.id
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
