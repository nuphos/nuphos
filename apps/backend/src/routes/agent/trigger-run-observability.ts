import { turnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'
import { captureException } from '@/lib/posthog'

import { traceAgentChatError } from './trace'

import type { AgentRunTrace } from './types'

/** The agent's own state, which the app already names: its computer is offline,
 *  its provider hit a usage limit, or it needs signing in. Not a fault. The state
 *  probe keeps the original failure as its cause. */
function isAgentState(error: unknown): boolean {
  return (
    turnFailureCause(error) !== 'other' ||
    (error instanceof Error && turnFailureCause(error.cause) !== 'other')
  )
}

export function recordTriggerRunFailure(
  error: unknown,
  trace: AgentRunTrace,
  source: string,
  runtime: { buildSha?: string; adapterVersion?: string } = {},
): void {
  const errorContext = {
    source,
    build_sha: runtime.buildSha ?? null,
    adapter_version: runtime.adapterVersion ?? null,
  }

  traceAgentChatError('agent.trigger.request.error', error, trace, errorContext)
  if (isAgentState(error)) return
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
