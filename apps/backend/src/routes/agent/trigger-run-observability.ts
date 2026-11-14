import { captureException } from '@/lib/posthog'

import { traceAgentChatError } from './trace'

import type { AgentRunTrace } from './types'

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
