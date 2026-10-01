import { AppError } from '@/lib/errors'

import { runtimeErrorPrefix, runtimeLabel } from './runtime-provider'

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
    `${provider === 'codex' ? 'Codex' : 'Claude Code'} is not set up in this workspace yet. A workspace administrator must add an agent in Settings → Agent and sign it in before using Agent.`,
  )
}

export function validateRequestedAgentRuntime(
  value: unknown,
): asserts value is OpenAbProvider | undefined {
  if (value !== undefined && value !== 'claude-code' && value !== 'codex') {
    throw new AppError(400, 'invalid_request', 'agentRuntime must be claude-code or codex')
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

/** Existing native transcripts belong to the server, including pre-runtime-stamp documents. */
export function isServerAuthoritativeTranscript(
  conversation: Pick<AgentConversation, 'agentRuntime' | 'claudeCodePreview'> | null,
): boolean {
  return Boolean(
    conversation?.agentRuntime === 'claude-code' ||
    conversation?.agentRuntime === 'codex' ||
    conversation?.claudeCodePreview,
  )
}

/** A creation preference never overrides an existing conversation's provider. */
export function resolveConversationAgentRuntime(
  conversation: Pick<AgentConversation, 'agentRuntime' | 'claudeCodePreview'> | null,
  teamDefault: ConversationAgentRuntime,
  requestedRuntime?: OpenAbProvider,
): ConversationAgentRuntime {
  if (conversation?.agentRuntime === 'codex') return 'codex'
  if (conversation?.agentRuntime || conversation?.claudeCodePreview) return 'claude-code'

  return requestedRuntime ?? (teamDefault === 'codex' ? 'codex' : 'claude-code')
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
