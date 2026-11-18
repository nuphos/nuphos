import { turnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'
import { userSetupFailure } from '@/lib/claude-code-preview/plain-failure'
import { isRuntimeRefusal } from '@/lib/claude-code-preview/runtime-refusal'
import { captureException } from '@/lib/posthog'

import { traceAgentChatError } from './trace'

import type { AgentRunTrace } from './types'

/**
 * The agent's own state or the user's own setup, which the app already names, or undefined
 * for a fault: busy (the message waits for the turn ahead), offline, out of usage, signed
 * out, a conversation too long for the model, a model the endpoint does not serve, an
 * agent CLI that cannot start, or a computer that cannot reach the model API.
 * The state probe keeps the original failure as its cause.
 */
function agentState(error: unknown): string | undefined {
  if (isRuntimeRefusal(error)) return 'busy'
  const setup = userSetupFailure(error)

  if (setup) return setup
  for (const failure of [error, error instanceof Error ? error.cause : undefined]) {
    const cause = turnFailureCause(failure)

    if (cause !== 'other') return cause
  }

  return undefined
}

export function recordTriggerRunFailure(
  error: unknown,
  trace: AgentRunTrace,
  source: string,
  runtime: { buildSha?: string; adapterVersion?: string } = {},
): void {
  const state = agentState(error)
  const errorContext = {
    source,
    // Counted in the logs; only a fault goes to Error Tracking.
    agent_state: state ?? null,
    build_sha: runtime.buildSha ?? null,
    adapter_version: runtime.adapterVersion ?? null,
  }

  traceAgentChatError('agent.trigger.request.error', error, trace, errorContext)
  if (state) return
  captureException(error, {
    source: 'agent.trigger.request',
    distinctId: trace.userId,
    properties: {
      request_id: trace.requestId,
      session_id: trace.sessionId,
      team_id: trace.teamId,
      stream_id: trace.streamId,
      route: trace.route,
      ...errorContext,
    },
  })
}
