import { turnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'
import { userSetupFailure } from '@/lib/claude-code-preview/plain-failure'
import { isRuntimeRefusal, resentAfter } from '@/lib/claude-code-preview/runtime-refusal'
import { errorTelemetryProperties } from '@/lib/observability'
import { captureException } from '@/lib/posthog'

import { traceAgentChatError, traceAgentChatEvent } from './trace'

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

/**
 * Logs a trigger turn that did not run, and says whether it failed. A turn the queue sends again
 * (`resentAfter`: a busy runtime's refusal, or an agent host away or offline) is expected: a
 * warning, and not a failure.
 */
export function recordTriggerRunFailure(
  error: unknown,
  trace: AgentRunTrace,
  source: string,
  runtime: { buildSha?: string; adapterVersion?: string } = {},
  resent = false,
): boolean {
  if (resentAfter(error, { clientResendsRefusal: resent })) {
    traceAgentChatEvent('warn', 'agent.turn.requeued', trace, {
      source,
      ...errorTelemetryProperties(error),
    })

    return false
  }
  const state = agentState(error)
  const errorContext = {
    source,
    // Counted in the logs; only a fault goes to Error Tracking.
    agent_state: state ?? null,
    build_sha: runtime.buildSha ?? null,
    adapter_version: runtime.adapterVersion ?? null,
  }

  traceAgentChatError('agent.trigger.request.error', error, trace, errorContext)
  if (state) return true
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

  return true
}
